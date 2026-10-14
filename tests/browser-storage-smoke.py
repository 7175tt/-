"""Check exclusive-tab storage ownership and automatic handoff in a real browser.

Run: BASE_URL=http://127.0.0.1:3000 python3 tests/browser-storage-smoke.py
Requires Python Playwright and Chromium. Uses synthetic contacts; Google requests
are blocked and Gemini readiness is mocked. No external account is accessed.
"""

import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect


BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000").rstrip("/")
OUTPUT = Path(os.environ.get("TEST_RESULTS_DIR", "test-results"))
BLOCKED = "名片管家已在另一個分頁開啟。請關閉另一個分頁，此頁會自動接續。"
INSTRUMENT = """(() => {
  window.storageOpens = 0;
  window.storagePuts = 0;
  const open = IDBFactory.prototype.open;
  const put = IDBObjectStore.prototype.put;
  IDBFactory.prototype.open = function(...args) {
    window.storageOpens++;
    return open.apply(this, args);
  };
  IDBObjectStore.prototype.put = function(...args) {
    window.storagePuts++;
    return put.apply(this, args);
  };
})()"""
READ = """() => new Promise((resolve, reject) => {
  const request = indexedDB.open('business-card-keeper', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction('snapshots', 'readonly');
    const get = tx.objectStore('snapshots').get('current');
    tx.oncomplete = () => { db.close(); resolve(get.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  };
})"""


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed, errors = [], []
    external_hosts = set()
    failure = None

    def mark(label):
        passed.append(label)
        print(f"PASS {label}", flush=True)

    def intercept(route):
        parsed = urlsplit(route.request.url)
        if parsed.netloc != urlsplit(BASE_URL).netloc:
            external_hosts.add(parsed.hostname)
            route.abort()
        elif parsed.path == "/api/gemini/status":
            route.fulfill(json={"configured": False})
        else:
            route.continue_()

    def page_for(context):
        page = context.new_page()
        page.set_default_timeout(15_000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("dialog", lambda dialog: dialog.accept())
        response = page.goto(BASE_URL, wait_until="domcontentloaded")
        assert response and response.status == 200
        return page

    def wait_names(page, names):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            snapshot = page.evaluate(READ)
            if snapshot and {card["name"] for card in snapshot["cards"]} == set(names):
                return snapshot
            page.wait_for_timeout(50)
        raise AssertionError(f"Expected committed contacts {names}, got {snapshot}")

    def add_card(page, name):
        page.get_by_role("button", name="手動新增名片", exact=True).click()
        page.get_by_label("姓名", exact=True).fill(name)
        page.get_by_role("button", name="建立名片", exact=True).click()
        expect(page.get_by_role("heading", name=name, exact=True)).to_be_visible()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True,
        )
        context = browser.new_context(viewport={"width": 1200, "height": 900})
        context.route("**/*", intercept)
        context.add_init_script(INSTRUMENT)
        unsupported = None
        try:
            first = page_for(context)
            expect(first.get_by_role("button", name="手動新增名片", exact=True)).to_be_visible()
            mark("first tab acquires storage ownership under React StrictMode")

            second = page_for(context)
            expect(second.get_by_text(BLOCKED, exact=True)).to_be_visible()
            expect(second.get_by_role("button", name="手動新增名片", exact=True)).to_have_count(0)
            assert second.evaluate("[window.storageOpens, window.storagePuts]") == [0, 0]
            mark("second tab shows waiting screen without reading or writing IndexedDB")

            add_card(first, "Storage Contact A")
            wait_names(first, ["Storage Contact A"])
            assert second.evaluate("[window.storageOpens, window.storagePuts]") == [0, 0]
            mark("active tab commits A while waiting tab remains unable to mutate storage")

            first.close()
            expect(second.get_by_role("heading", name="Storage Contact A", exact=True)).to_be_visible()
            expect(second.get_by_text(BLOCKED, exact=True)).to_have_count(0)
            wait_names(second, ["Storage Contact A"])
            mark("closing owner automatically hands latest durable snapshot to waiting tab")

            add_card(second, "Storage Contact B")
            wait_names(second, ["Storage Contact A", "Storage Contact B"])
            second.reload(wait_until="domcontentloaded")
            for name in ("Storage Contact A", "Storage Contact B"):
                expect(second.get_by_role("heading", name=name, exact=True)).to_be_visible()
            wait_names(second, ["Storage Contact A", "Storage Contact B"])
            mark("handoff owner saves B and reload retains both A and B")

            # A queued tab closed before takeover must not leak a lock request.
            cancelled = page_for(context)
            expect(cancelled.get_by_text(BLOCKED, exact=True)).to_be_visible()
            cancelled.close()
            second.reload(wait_until="domcontentloaded")
            expect(second.get_by_role("heading", name="Storage Contact B", exact=True)).to_be_visible()
            mark("closing a waiting tab does not prevent owner reload from reacquiring")

            unsupported = browser.new_context()
            unsupported.route("**/*", intercept)
            unsupported.add_init_script(INSTRUMENT)
            unsupported.add_init_script("Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });")
            unavailable = page_for(unsupported)
            expect(unavailable.get_by_role("alert")).to_contain_text("此瀏覽器無法安全協調名片儲存")
            expect(unavailable.get_by_role("button", name="手動新增名片", exact=True)).to_have_count(0)
            assert unavailable.evaluate("[window.storageOpens, window.storagePuts]") == [0, 0]
            mark("unsupported Web Locks explain blocked storage without opening IndexedDB")

            assert not errors, errors
            mark("no uncaught browser errors across ownership, cancellation, and unsupported paths")
        except Exception as error:
            failure = str(error)
            raise
        finally:
            report = {"passed": passed, "page_errors": errors, "failure": failure,
                      "blocked_external_hosts": sorted(external_hosts)}
            (OUTPUT / "browser-storage-smoke.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(report, ensure_ascii=False), flush=True)
            if unsupported:
                unsupported.close()
            context.close()
            browser.close()


if __name__ == "__main__":
    main()
