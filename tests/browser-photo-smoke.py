"""Real-browser photo rendering and recovery with synthetic private Drive images.

Run: BASE_URL=http://127.0.0.1:3111 python3 tests/browser-photo-smoke.py
Requires Python Playwright and Chromium. No real Google account is accessed.
"""

import asyncio
import base64
import json
import os
import runpy
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect


BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3111').rstrip('/')
OUTPUT = Path(os.environ.get('TEST_RESULTS_DIR', 'test-results/photos'))
SYNC = runpy.run_path(str(Path(__file__).with_name('browser-sync-smoke.py')))
SEED = r"""(() => {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 320, 200);
  ctx.fillStyle = '#17435b'; ctx.fillRect(0, 0, 20, 200);
  ctx.font = '22px sans-serif'; ctx.fillText('Synthetic card photo', 30, 80);
  window.testPhoto = canvas.toDataURL('image/jpeg');
  const card = (id, extra) => ({ id, name: id, company: 'Synthetic', title: '', phone: '', email: '',
    address: '', notes: '', rawText: '', timestamp: 100, cloudAccount: 'a@example.invalid', ...extra });
  const cards = [
    card('raw-local', {imageBase64: window.testPhoto.split(',')[1]}),
    card('data-url-local', {imageBase64: window.testPhoto}),
    card('cloud-edit', {imageDriveId: 'edit-photo'}),
    card('cloud-retry', {imageDriveId: 'retry-photo'}),
    card('cloud-delayed', {imageDriveId: 'delayed-photo'}),
    card('cloud-view', {imageDriveId: 'view-photo'}),
  ];
  localStorage.setItem('business-cards-db', JSON.stringify(cards));
  window.__cloud.rows.a.push(...cards.map(c => window.__cloud.rows.a[0].map(header => c[header] ?? '')));
})()"""


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks, errors, requests = [], [], []
    retry_status = 403
    allow_cloud = True
    photo_bytes = b''
    delayed_started, delayed_release, delayed_finished = asyncio.Event(), asyncio.Event(), asyncio.Event()

    def mark(label):
        checks.append(label)
        print(f'PASS {label}', flush=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
        context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        await context.add_init_script(SYNC['MOCK'] + '\n' + SEED)

        async def intercept(route):
            parsed = urlsplit(route.request.url)
            if parsed.hostname == 'www.googleapis.com' and parsed.path.startswith('/drive/v3/files/'):
                file_id = parsed.path.rsplit('/', 1)[-1]
                requests.append(file_id)
                assert route.request.headers.get('authorization') == 'Bearer test-token-a'
                if not allow_cloud:
                    await route.abort()
                elif file_id == 'retry-photo' and retry_status != 200:
                    if retry_status == 299:
                        await route.fulfill(status=200, content_type='text/html', body='This is not a photograph')
                    else:
                        await route.fulfill(status=retry_status, json={'error': {'message': 'Synthetic Drive failure'}})
                else:
                    if file_id == 'delayed-photo':
                        delayed_started.set()
                        await delayed_release.wait()
                    await route.fulfill(status=200, content_type='image/jpeg', body=photo_bytes)
                    if file_id == 'delayed-photo':
                        delayed_finished.set()
            elif parsed.hostname == 'www.googleapis.com' and parsed.path == '/oauth2/v3/userinfo':
                await route.fulfill(json={'name': 'Synthetic account', 'email': 'a@example.invalid', 'picture': ''})
            elif parsed.netloc != urlsplit(BASE_URL).netloc:
                await route.abort()
            elif parsed.path == '/api/gemini/status':
                await route.fulfill(json={'configured': True})
            else:
                await route.continue_()

        await context.route('**/*', intercept)
        page = await context.new_page()
        page.set_default_timeout(15_000)
        page.on('pageerror', lambda error: errors.append(str(error)))

        def article(name):
            return page.locator('article').filter(has=page.get_by_role('heading', name=name, exact=True))

        async def displayed_photo(locator):
            await expect(locator).to_be_visible()
            await locator.evaluate('image => image.decode()')
            assert await locator.evaluate('image => image.naturalWidth === 320 && image.naturalHeight === 200')

        async def switch_view(name):
            await page.get_by_role('button', name='資料管理與設定', exact=True).click()
            await page.get_by_role('button', name=name, exact=True).click()

        async def open_edit(name):
            await page.get_by_role('button', name=f'編輯 {name} 的名片', exact=True).click()

        try:
            await page.goto(BASE_URL, wait_until='domcontentloaded')
            await expect(page.get_by_role('heading', name='raw-local', exact=True)).to_be_visible()
            photo_bytes = base64.b64decode((await page.evaluate('window.testPhoto')).split(',')[1])
            for name in ['raw-local', 'data-url-local']:
                await displayed_photo(article(name).get_by_alt_text('名片縮圖', exact=True))
            mark('new bare-base64 and legacy data-URL photos decode in card view')

            await switch_view('列表檢視')
            for name in ['raw-local', 'data-url-local']:
                await displayed_photo(article(name).get_by_alt_text('名片縮圖', exact=True))
                await article(name).get_by_role('button', name='查看名片照片', exact=True).click()
                await displayed_photo(page.get_by_role('dialog', name='名片照片預覽').locator('img'))
                await page.keyboard.press('Escape')
                await expect(page.get_by_role('dialog', name='名片照片預覽')).to_have_count(0)
            assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
            await page.screenshot(path=str(OUTPUT / 'mobile-photo-list.png'))
            mark('list view displays photos, opens full previews and closes with Escape without overflow')

            await expect(article('cloud-edit').get_by_text('登入後查看', exact=True)).to_be_visible()
            await open_edit('cloud-edit')
            await expect(page.get_by_text('照片保存在 Google 雲端，請登入儲存這張名片的 Google 帳號後查看。', exact=True)).to_be_visible()
            assert not requests
            await page.get_by_role('button', name='返回名片列表', exact=True).click()
            mark('signed-out cloud photos have a visible explanation and never make unauthenticated requests')

            await SYNC['tool_action'](page, '登入並自動同步')
            await expect(page.get_by_role('status', name='本機已儲存 · 已與 Google 同步', exact=True)).to_be_visible()
            await open_edit('cloud-edit')
            await displayed_photo(page.get_by_alt_text('名片原始照片，可對照下方辨識內容', exact=True))
            await SYNC['wait_snapshot'](page, "state => state.cards.find(c => c.id === 'cloud-edit')?.imageBase64")
            await page.get_by_label('備註', exact=True).fill('Photo downloaded while editing')
            dismiss = page.get_by_role('button', name='關閉提示', exact=True)
            if await dismiss.is_visible():
                await dismiss.click()
            await page.get_by_alt_text('名片原始照片，可對照下方辨識內容', exact=True).scroll_into_view_if_needed()
            await page.screenshot(path=str(OUTPUT / 'mobile-cloud-photo-edit.png'))
            await page.get_by_role('button', name='儲存變更', exact=True).click()
            snapshot = await SYNC['wait_snapshot'](page, "state => state.cards.find(c => c.id === 'cloud-edit')?.notes === 'Photo downloaded while editing'")
            assert next(c for c in snapshot['cards'] if c['id'] == 'cloud-edit')['imageDriveId'] == 'edit-photo'
            mark('editing automatically downloads its private Drive photo, caches it and preserves the cloud reference')

            await article('cloud-view').get_by_role('button', name='載入名片照片', exact=True).click()
            await displayed_photo(page.get_by_role('dialog', name='名片照片預覽').locator('img'))
            await page.get_by_role('button', name='關閉預覽', exact=True).click()
            await SYNC['wait_snapshot'](page, "state => state.cards.find(c => c.id === 'cloud-view')?.imageBase64")
            mark('list-view cloud photo button downloads and opens the photo')

            await open_edit('cloud-retry')
            await expect(page.get_by_role('status').filter(has_text='沒有這張照片的存取權')).to_be_visible()
            retry_count = requests.count('retry-photo')
            await page.wait_for_timeout(300)
            assert requests.count('retry-photo') == retry_count, 'Failures must wait for a manual retry'
            retry_status = 299
            await page.get_by_role('button', name='重新載入名片照片', exact=True).click()
            await expect(page.get_by_role('status').filter(has_text='無法開啟雲端照片')).to_be_visible()
            snapshot = await page.evaluate(SYNC['READ_SNAPSHOT'])
            card = next(c for c in snapshot['cards'] if c['id'] == 'cloud-retry')
            assert not card.get('imageBase64') and card['imageDriveId'] == 'retry-photo'
            retry_status = 200
            await page.get_by_role('button', name='重新載入名片照片', exact=True).click()
            await displayed_photo(page.get_by_alt_text('名片原始照片，可對照下方辨識內容', exact=True))
            await page.get_by_role('button', name='返回名片列表', exact=True).click()
            mark('Drive permission and invalid-image failures explain the problem, preserve the reference and recover on retry')

            await open_edit('cloud-delayed')
            await asyncio.wait_for(delayed_started.wait(), 15)
            await page.get_by_role('button', name='移除照片', exact=True).click()
            delayed_release.set()
            await asyncio.wait_for(delayed_finished.wait(), 15)
            await expect(page.get_by_role('button', name='新增名片照片（選填）', exact=True)).to_be_visible()
            await page.get_by_role('button', name='儲存變更', exact=True).click()
            snapshot = await SYNC['wait_snapshot'](page, "state => { const c = state.cards.find(c => c.id === 'cloud-delayed'); return c && !c.imageDriveId && !c.imageBase64; }")
            assert not next(c for c in snapshot['cards'] if c['id'] == 'cloud-delayed').get('imageBase64')
            mark('removing a photo during download cannot resurrect it when the old response arrives')

            allow_cloud = False
            await page.reload(wait_until='domcontentloaded')
            for name in ['raw-local', 'data-url-local', 'cloud-edit', 'cloud-view', 'cloud-retry']:
                await displayed_photo(article(name).get_by_alt_text('名片縮圖', exact=True))
            mark('downloaded photos remain visible after reload when further Drive requests are blocked')
            await SYNC['tool_action'](page, '登出')
            for name in ['cloud-edit', 'cloud-view', 'cloud-retry']:
                await displayed_photo(article(name).get_by_alt_text('名片縮圖', exact=True))
                await expect(article(name).get_by_role('status')).to_have_count(0)
            mark('cached photos remain usable after logout without misleading login warnings')
            assert not errors, errors
        except BaseException:
            await page.screenshot(path=str(OUTPUT / 'photo-failure.png'))
            raise
        finally:
            delayed_release.set()
            report = {'passed': checks, 'page_errors': errors, 'image_requests': requests}
            (OUTPUT / 'browser-photo-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            await context.close()
            await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
