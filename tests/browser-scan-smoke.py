"""Mobile scanning workflow against a running app, with synthetic AI responses.

Run: BASE_URL=http://127.0.0.1:3100 python3 tests/browser-scan-smoke.py
Requires Python Playwright and system Chromium; no live AI/Google calls are made.
"""

import asyncio
import base64
import hashlib
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect


BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3100").rstrip("/")
OUTPUT = Path(os.environ.get("TEST_RESULTS_DIR", "test-results"))
READ_SNAPSHOT = """async () => new Promise((resolve, reject) => {
  const open = indexedDB.open('business-card-keeper', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('snapshots', 'readonly');
    const request = tx.objectStore('snapshots').get('current');
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  };
})"""


async def wait_snapshot(page, predicate, argument=None):
    """Wait for the committed database state, not merely the optimistic UI."""
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = await page.evaluate(
            f"async argument => {{ const state = await ({READ_SNAPSHOT})(); const matches = ({predicate})(state, argument); return {{ matches, state: matches ? state : null }}; }}",
            argument,
        )
        if result["matches"]:
            return result["state"]
        await asyncio.sleep(0.05)
    raise AssertionError(f"Timed out waiting for committed IndexedDB condition: {predicate}")


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed = []
    page_errors = []
    blocked_external = set()
    image_ids = {}
    attempts = {}
    scan_calls = []
    active_scans = 0
    max_active_scans = 0
    failure = None

    def mark(label):
        passed.append(label)
        print(f"PASS {label}", flush=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"),
            headless=True,
        )
        context = await browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
            is_mobile=True,
            has_touch=True,
            accept_downloads=True,
        )
        # Deterministically exercise the gallery fallback without requesting a camera.
        await context.add_init_script("""navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Synthetic permission denial', 'NotAllowedError');
        };""")

        async def intercept(route):
            nonlocal active_scans, max_active_scans
            request = route.request
            parsed = urlsplit(request.url)
            if parsed.netloc != urlsplit(BASE_URL).netloc:
                blocked_external.add(parsed.hostname)
                await route.abort()
                return
            if parsed.path == "/api/gemini/status":
                await route.fulfill(json={"configured": True})
                return
            if parsed.path != "/api/gemini/scan":
                await route.continue_()
                return
            payload = request.post_data_json
            assert set(payload) == {"base64Image"}, "Scan must only send its image payload"
            image = payload["base64Image"]
            image_bytes = base64.b64decode(image)
            assert image_bytes[:3] == b"\xff\xd8\xff", "Gallery files must be converted to JPEG"
            assert len(image_bytes) <= 2 * 1024 * 1024, "Prepared scan should stay within 2 MiB"
            digest = hashlib.sha256(image_bytes).hexdigest()
            number = image_ids.setdefault(digest, len(image_ids) + 1)
            attempts[number] = attempts.get(number, 0) + 1
            active_scans += 1
            max_active_scans = max(max_active_scans, active_scans)
            scan_calls.append({"contact": number, "attempt": attempts[number]})
            try:
                # Keep requests outstanding long enough to observe queue parallelism.
                await asyncio.sleep(0.4)
                if number == 2 and attempts[number] == 1:
                    await route.fulfill(
                        status=503,
                        json={"error": "測試：掃描服務暫時忙碌，照片已保留。", "code": "SERVICE_UNAVAILABLE"},
                    )
                else:
                    await route.fulfill(json={"structuredData": {
                        "name": f"測試聯絡人 {number}",
                        "company": f"測試公司 {number}",
                        "title": "設計師",
                        "phone": f"+886-912-345-00{number}",
                        "email": f"contact{number}@example.invalid",
                        "address": "測試市測試路 1 號",
                        "notes": "合成資料，無真實個人資訊",
                        "rawText": f"測試聯絡人 {number}\nSOURCE-ONLY-MARKER-{number}\n測試公司 {number}",
                    }})
            finally:
                active_scans -= 1

        await context.route("**/*", intercept)
        page = await context.new_page()
        page.set_default_timeout(15_000)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        try:
            response = await page.goto(BASE_URL, wait_until="domcontentloaded")
            assert response and response.status == 200
            await expect(page.get_by_role("heading", name="把第一張名片收進手機", exact=True)).to_be_visible()
            mark("mobile empty state loads without external Google services")

            images = await page.evaluate("""() => [1, 2, 3, 4].map(number => {
              const canvas = document.createElement('canvas');
              canvas.width = 2600; canvas.height = 1650;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.fillStyle = ['#17435b', '#784350', '#236845', '#783a20'][number - 1];
              ctx.fillRect(0, 0, 160, canvas.height);
              ctx.font = 'bold 100px sans-serif';
              ctx.fillText(`Synthetic Contact ${number}`, 260, 420);
              ctx.font = '65px sans-serif';
              ctx.fillText(`contact${number}@example.invalid`, 260, 650);
              ctx.fillText('Synthetic business card - smoke test only', 260, 850);
              return canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
            })""")
            await page.get_by_role("button", name="掃描新名片", exact=True).click()
            await expect(page.get_by_text(re.compile("相機權限尚未開啟"))).to_be_visible()
            await page.get_by_label("從相簿選擇名片照片", exact=True).set_input_files([
                {"name": f"synthetic-card-{index + 1}.jpg", "mimeType": "image/jpeg", "buffer": base64.b64decode(image)}
                for index, image in enumerate(images)
            ])
            finish = page.get_by_role("button", name="完成（4）", exact=True)
            await expect(finish).to_be_enabled()
            await page.screenshot(path=str(OUTPUT / "mobile-scanner.png"))
            await finish.click()
            snapshot = await wait_snapshot(page, "state => state.cards.length === 4 && state.cards.every(card => !card.isProcessing)")
            assert len(image_ids) == 4 and len(scan_calls) == 4
            assert max_active_scans == 2, f"Expected two parallel workers, saw {max_active_scans}"
            assert sum(bool(card.get("isError")) for card in snapshot["cards"]) == 1
            assert sum(bool(card.get("needsReview")) for card in snapshot["cards"]) == 3
            assert all(card.get("imageBase64") for card in snapshot["cards"])
            assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            mark("four gallery photos complete with at most two concurrent scans and three review prompts")

            failed = next(card for card in snapshot["cards"] if card.get("isError"))
            failure_id, failure_photo = failed["id"], failed["imageBase64"]
            await page.reload(wait_until="domcontentloaded")
            await expect(page.get_by_role("heading", name="名片辨識未完成", exact=True)).to_be_visible()
            await expect(page.get_by_alt_text("辨識未完成的名片", exact=True)).to_be_visible()
            reloaded = await page.evaluate(READ_SNAPSHOT)
            assert next(card for card in reloaded["cards"] if card["id"] == failure_id)["imageBase64"] == failure_photo
            await page.get_by_role("button", name="重新辨識名片", exact=True).click()
            snapshot = await wait_snapshot(page, "(state, id) => state.cards.some(card => card.id === id && card.name === '測試聯絡人 2' && !card.isProcessing && !card.isError)", failure_id)
            recovered = next(card for card in snapshot["cards"] if card["id"] == failure_id)
            assert recovered["imageBase64"] == failure_photo and recovered["needsReview"]
            assert len(snapshot["cards"]) == 4 and attempts[2] == 2 and len(scan_calls) == 5
            mark("failed scan preserves its photo through IndexedDB reload and retries the same record")

            await page.get_by_role("button", name="確認 測試聯絡人 1 的辨識結果", exact=True).click()
            await expect(page.get_by_role("heading", name="核對名片", exact=True)).to_be_visible()
            photo = page.get_by_alt_text("名片原始照片，可對照下方辨識內容", exact=True)
            await expect(photo).to_be_visible()
            await expect(page.get_by_label("姓名", exact=True)).to_have_value("測試聯絡人 1")
            assert await photo.evaluate("image => image.complete && image.naturalWidth === 2000 && image.naturalHeight > 0")
            await page.screenshot(path=str(OUTPUT / "mobile-review.png"))
            await page.get_by_label("姓名", exact=True).fill("已核對聯絡人")
            await page.get_by_label("備註", exact=True).fill("展場認識，下週聯絡")
            await page.get_by_role("button", name="確認並儲存", exact=True).click()
            snapshot = await wait_snapshot(page, "state => state.cards.some(card => card.name === '已核對聯絡人' && card.notes === '展場認識，下週聯絡' && card.needsReview === false)")
            edited_id = next(card["id"] for card in snapshot["cards"] if card["name"] == "已核對聯絡人")
            await page.reload(wait_until="domcontentloaded")
            await expect(page.get_by_role("heading", name="已核對聯絡人", exact=True)).to_be_visible()
            assert next(card for card in (await page.evaluate(READ_SNAPSHOT))["cards"] if card["id"] == edited_id)["needsReview"] is False
            mark("review shows the downscaled original photo and saves corrected fields across reload")

            search = page.get_by_role("searchbox")
            await search.fill("SOURCE-ONLY-MARKER-1")
            await expect(page.get_by_role("heading", name="已核對聯絡人", exact=True)).to_be_visible()
            await expect(page.locator("article")).to_have_count(1)
            await page.get_by_role("button", name="顯示或隱藏搜尋選項", exact=True).click()
            await page.get_by_label("選擇搜尋欄位", exact=True).select_option("rawText")
            await expect(page.locator("article")).to_have_count(1)
            await page.screenshot(path=str(OUTPUT / "mobile-search.png"))
            await search.fill("")
            await page.get_by_label("選擇搜尋欄位", exact=True).select_option("all")
            await page.get_by_role("button", name="顯示或隱藏搜尋選項", exact=True).click()
            mark("full-text and field-specific searches find text present only in the OCR original")

            await page.get_by_role("button", name="手動新增名片", exact=True).click()
            await expect(page.get_by_role("heading", name="新增名片", exact=True)).to_be_visible()
            await page.get_by_label("姓名", exact=True).fill("手動聯絡人")
            await page.get_by_label("公司", exact=True).fill("本機測試公司")
            await page.get_by_label("電話", exact=True).fill("+886-912-000-001")
            await page.get_by_label("Email", exact=True).fill("manual@example.invalid")
            await page.get_by_role("button", name="建立名片", exact=True).click()
            await wait_snapshot(page, "state => state.cards.length === 5 && state.cards.some(card => card.name === '手動聯絡人' && card.needsReview === false)")
            assert len(scan_calls) == 5, "Manual entry must not make an AI request"
            await expect(page.get_by_role("heading", name="手動聯絡人", exact=True)).to_be_visible()
            mark("manual entry creates a searchable contact without an AI request")

            async with page.expect_download() as download_info:
                await page.get_by_role("button", name="將 手動聯絡人 存到通訊錄", exact=True).click()
            download = await download_info.value
            assert download.suggested_filename.endswith(".vcf")
            export_path = OUTPUT / "synthetic-contact.vcf"
            await download.save_as(export_path)
            vcard = export_path.read_text(encoding="utf-8")
            assert vcard.count("BEGIN:VCARD") == 1
            assert "FN:手動聯絡人" in vcard and "manual@example.invalid" in vcard and "+886912000001" in vcard
            assert await page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            dismiss = page.get_by_role("button", name="關閉提示", exact=True)
            if await dismiss.is_visible():
                await dismiss.click()
            await page.screenshot(path=str(OUTPUT / "mobile-contacts.png"))
            mark("contact downloads as a valid vCard containing the saved name, email and phone")
            assert not page_errors, page_errors
            mark("no uncaught browser errors or horizontal overflow at 390 × 844")
            (OUTPUT / "mobile-failure.png").unlink(missing_ok=True)
        except Exception as error:
            failure = f"{type(error).__name__}: {error}"
            await page.screenshot(path=str(OUTPUT / "mobile-failure.png"))
            raise
        finally:
            report = {
                "base_url": BASE_URL,
                "viewport": {"width": 390, "height": 844},
                "passed": passed,
                "max_concurrent_scans": max_active_scans,
                "scan_calls": scan_calls,
                "page_errors": page_errors,
                "blocked_external_hosts": sorted(blocked_external),
                "failure": failure,
            }
            (OUTPUT / "browser-scan-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False), flush=True)
            await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
