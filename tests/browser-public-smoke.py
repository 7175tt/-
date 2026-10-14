"""Public pages and OAuth consent/session regression with synthetic Google data.

Run: BASE_URL=http://127.0.0.1:3000 python3 tests/browser-public-smoke.py
Requires Python Playwright and Chromium. No live Google account is accessed.
"""

import asyncio
import importlib.util
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect


BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:3000").rstrip("/")
OUTPUT = Path(os.environ.get("TEST_RESULTS_DIR", "test-results"))
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("sync_fixture", Path(__file__).with_name("browser-sync-smoke.py"))
sync_fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync_fixture)
INIT = sync_fixture.MOCK + r"""
localStorage.removeItem('business-cards-db');
window.__publicAuth = { options: null, signInRequests: 0, installedTokens: 0 };
const originalSetToken = gapi.client.setToken;
gapi.client.setToken = token => {
  if (token?.access_token) window.__publicAuth.installedTokens++;
  originalSetToken(token);
};
const originalInit = google.accounts.oauth2.initTokenClient;
google.accounts.oauth2.initTokenClient = options => {
  window.__publicAuth.options = {
    clientId: options.client_id, scope: options.scope,
    includeGrantedScopes: options.include_granted_scopes,
  };
  const client = originalInit(options);
  return { requestAccessToken: config => {
    window.__publicAuth.signInRequests++;
    return client.requestAccessToken(config);
  } };
};
"""


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed, page_errors, contexts = [], [], []
    blocked_external = set()
    failure = None

    def mark(label):
        passed.append(label)
        print(f"PASS {label}", flush=True)

    async def intercept(route):
        parsed = urlsplit(route.request.url)
        if parsed.hostname == "www.googleapis.com" and parsed.path == "/oauth2/v3/userinfo":
            assert route.request.headers.get("authorization") == "Bearer test-token-a"
            await route.fulfill(json={"name": "Synthetic Account A", "email": "a@example.invalid", "picture": ""})
        elif parsed.netloc != urlsplit(BASE_URL).netloc:
            blocked_external.add(parsed.hostname)
            await route.abort()
        elif parsed.path == "/api/gemini/status":
            await route.fulfill(json={"configured": False})
        else:
            await route.continue_()

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.environ.get("CHROMIUM_PATH", "/usr/bin/chromium"), headless=True)

        async def app_page(session=None, remote_card=False):
            context = await browser.new_context(viewport={"width": 390, "height": 844})
            contexts.append(context)
            await context.route("**/*", intercept)
            script = INIT
            if session is not None:
                script += "\nsessionStorage.setItem('KEEPER_GOOGLE_AUTH', JSON.stringify(" + json.dumps(session) + "));"
            if remote_card:
                script += "\nwindow.__cloud.rows.a.push(['public-restore', 'Restored Cloud Contact', 'Synthetic Company', '', '', '', '', '', 100, '', '']);"
            await context.add_init_script(script)
            page = await context.new_page()
            page.set_default_timeout(15_000)
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            response = await page.goto(BASE_URL, wait_until="domcontentloaded")
            assert response and response.status == 200
            await expect(page.get_by_role("heading", name="名片管家", exact=True)).to_be_visible()
            await page.wait_for_function("window.__publicAuth.options !== null")
            return context, page

        async def tools(page):
            toggle = page.get_by_role("button", name="資料管理與設定", exact=True)
            if await toggle.get_attribute("aria-expanded") != "true":
                await toggle.click()

        try:
            # Browser-loaded HTML/CSS must stand on their own with page JavaScript disabled.
            public_requests = []
            static = await browser.new_context(java_script_enabled=False)
            contexts.append(static)

            async def static_route(route):
                parsed = urlsplit(route.request.url)
                if parsed.netloc != urlsplit(BASE_URL).netloc:
                    public_requests.append(route.request.url)
                    await route.abort()
                else:
                    await route.continue_()

            await static.route("**/*", static_route)
            public_page = await static.new_page()
            for width in (320, 390):
                await public_page.set_viewport_size({"width": width, "height": 844})
                for path in ("/about.html", "/privacy.html"):
                    response = await public_page.goto(BASE_URL + path, wait_until="load")
                    assert response and response.status == 200, path
                    assert "text/html" in response.headers.get("content-type", ""), path
                    await expect(public_page.locator("h1")).to_be_visible()
                    assert await public_page.locator("script").count() == 0, path
                    assert len((await public_page.locator("main").inner_text()).strip()) > 100, path
                    assert await public_page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), (path, width)
                    links = await public_page.locator("a[href]").evaluate_all("links => links.map(link => link.getAttribute('href'))")
                    assert "/" in links, (path, "missing app return link")
                    other = "/privacy.html" if path == "/about.html" else "/about.html"
                    assert other in links, (path, "missing companion page link")
                    assert all(not href.lower().startswith("javascript:") for href in links)
                    await public_page.screenshot(path=str(OUTPUT / f"public-{path[1:-5]}-{width}.png"), full_page=True)
            assert public_requests == [], public_requests
            mark("about/privacy serve complete static HTML without JavaScript or external requests at 320/390px")

            fresh_context, fresh = await app_page()
            await fresh.screenshot(path=str(OUTPUT / "public-empty-390.png"))
            await tools(fresh)
            login = fresh.get_by_role("button", name="登入並自動同步", exact=True)
            privacy = fresh.get_by_role("link", name="隱私與資料使用", exact=True)
            await expect(login).to_be_enabled()
            await expect(privacy).to_be_visible()
            assert await privacy.get_attribute("href") == "/privacy.html"
            assert await privacy.get_attribute("target") == "_blank"
            assert "noopener" in (await privacy.get_attribute("rel") or "").split()
            options = await fresh.evaluate("window.__publicAuth.options")
            assert set(options["scope"].split()) == {
                "https://www.googleapis.com/auth/drive.file",
                "https://www.googleapis.com/auth/userinfo.profile",
                "https://www.googleapis.com/auth/userinfo.email",
            }
            assert options["includeGrantedScopes"] is False
            assert await fresh.evaluate("window.__publicAuth.signInRequests") == 0
            await login.click()
            await fresh.wait_for_function("JSON.parse(sessionStorage.getItem('KEEPER_GOOGLE_AUTH') || 'null')?.authPolicy === 'drive-file-v1'")
            matching_session = await fresh.evaluate("JSON.parse(sessionStorage.getItem('KEEPER_GOOGLE_AUTH'))")
            assert matching_session["clientId"] == options["clientId"]
            assert await fresh.evaluate("window.__publicAuth.signInRequests") == 1
            assert await fresh.evaluate("localStorage.getItem('KEEPER_GOOGLE_AUTH')") is None
            mark("logged-out consent links privacy and requests only drive.file/profile/email without incremental grants")
            await fresh_context.close()

            legacy = dict(matching_session)
            legacy.pop("authPolicy")
            foreign = dict(matching_session, clientId="foreign-client.apps.googleusercontent.com")
            for label, session in (("legacy", legacy), ("foreign-client", foreign)):
                context, page = await app_page(session)
                await page.wait_for_function("sessionStorage.getItem('KEEPER_GOOGLE_AUTH') === null")
                await tools(page)
                await expect(page.get_by_role("button", name="登入並自動同步", exact=True)).to_be_enabled()
                await asyncio.sleep(1.3)
                observation = await page.evaluate("({installed: __publicAuth.installedTokens, requested: __publicAuth.signInRequests, writes: __cloud.writes.length, events: __cloud.events.length})")
                assert observation == {"installed": 0, "requested": 0, "writes": 0, "events": 0}, (label, observation)
                await context.close()
            mark("legacy-policy and foreign-client sessions are discarded without installing tokens or cloud operations")

            context, restored = await app_page(matching_session, remote_card=True)
            await expect(restored.get_by_role("heading", name="Restored Cloud Contact", exact=True)).to_be_visible()
            await tools(restored)
            await expect(restored.get_by_role("button", name="登出", exact=True)).to_be_visible()
            await expect(restored.get_by_role("button", name="登入並自動同步", exact=True)).to_have_count(0)
            observation = await restored.evaluate("({installed: __publicAuth.installedTokens, requested: __publicAuth.signInRequests, read: __cloud.events.some(event => event.action === 'read'), writes: __cloud.writes.length})")
            assert observation == {"installed": 1, "requested": 0, "read": True, "writes": 0}, observation
            mark("matching current-policy session restores identity and downloads cloud contact without another sign-in")
            await context.close()

            context, menu_page = await app_page()
            for name, path in (("關於名片管家", "/about.html"), ("隱私與資料使用", "/privacy.html")):
                await tools(menu_page)
                async with context.expect_page() as popup:
                    await menu_page.get_by_role("button", name=name, exact=True).click()
                tab = await popup.value
                await tab.wait_for_load_state("domcontentloaded")
                assert urlsplit(tab.url).path == path
                assert await tab.evaluate("window.opener === null")
                await expect(tab.locator("h1")).to_be_visible()
                assert menu_page.url.rstrip("/") == BASE_URL
                await tab.close()
            assert not page_errors, page_errors
            mark("tools open about/privacy in separate tabs with no opener and no uncaught app errors")
        except Exception as error:
            failure = str(error)
            raise
        finally:
            report = {"base_url": BASE_URL, "passed": passed, "page_errors": page_errors,
                      "failure": failure, "blocked_external_hosts": sorted(blocked_external)}
            (OUTPUT / "browser-public-smoke.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False), flush=True)
            for context in contexts:
                await context.close()
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
