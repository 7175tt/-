"""265 synthetic contacts: viewport photo loading, responsive density, compact tools.

Run: BASE_URL=http://127.0.0.1:3112 python3 tests/browser-density-smoke.py
All Google calls are mocked; no personal contact data or credentials are used.
"""
import asyncio
import base64
import json
import os
import runpy
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3112').rstrip('/')
OUTPUT = Path(os.environ.get('TEST_RESULTS_DIR', 'test-results/density'))
MOCK = runpy.run_path(str(Path(__file__).with_name('browser-sync-smoke.py')))['MOCK']
SEED = r"""(() => {
  const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f1f5f9'; ctx.fillRect(0, 0, 320, 200);
  ctx.fillStyle = '#1e40af'; ctx.fillRect(0, 0, 18, 200); ctx.font = 'bold 30px sans-serif';
  ctx.fillText('Business Card', 36, 72); ctx.font = '20px sans-serif'; ctx.fillText('Synthetic test photo', 36, 126);
  window.densityPhoto = canvas.toDataURL('image/jpeg');
  const cards = Array.from({length: 265}, (_, index) => ({
    id: `density-${index}`, name: `合成聯絡人 ${String(index + 1).padStart(3, '0')}`,
    company: '臺灣合成產業技術研究中心 Taiwan Synthetic Industry Research Center',
    title: '技術研發部 資深工程師 Senior Engineer', phone: '02-1234-5678 分機 123',
    email: `contact${index + 1}@example.invalid`, address: '合成市測試區測試路 123 號 10 樓',
    notes: '詳細備註完整保留。\n網站 https://example.invalid\n跨部門合作專案、技術背景及後續聯絡資訊。\n'.repeat(5),
    rawText: '', timestamp: 100, imageDriveId: `density-photo-${index}`, cloudAccount: 'a@example.invalid',
    lastSyncedAt: 100, lastSyncedSheetId: 'a-sheet'
  }));
  localStorage.setItem('business-cards-db', JSON.stringify(cards));
  window.__cloud.rows.a.push(...cards.map(card => window.__cloud.rows.a[0].map(header => card[header] ?? '')));
  sessionStorage.setItem('KEEPER_GOOGLE_AUTH', JSON.stringify({tokenResponse: {access_token: 'test-token-a'},
    user: {email: 'a@example.invalid', name: '測試帳號', picture: ''}, expiresAt: Date.now() + 3600000}));
})()"""


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    checks, measurements = [], []

    def mark(label):
        checks.append(label)
        print(f'PASS {label}', flush=True)

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
        for width, height in [(1372, 928), (390, 844)]:
            context = await browser.new_context(viewport={'width': width, 'height': height}, is_mobile=width < 600, has_touch=width < 600)
            await context.add_init_script(MOCK + '\n' + SEED)
            page = await context.new_page()
            errors, requests = [], []
            active, peak = 0, 0
            photo = b''
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_default_timeout(15_000)

            async def intercept(route):
                nonlocal active, peak, photo
                parsed = urlsplit(route.request.url)
                if parsed.hostname == 'www.googleapis.com' and parsed.path.startswith('/drive/v3/files/'):
                    assert route.request.headers.get('authorization') == 'Bearer test-token-a'
                    requests.append(parsed.path.rsplit('/', 1)[-1]); active += 1; peak = max(peak, active)
                    try:
                        if not photo:
                            photo = base64.b64decode((await page.evaluate('window.densityPhoto')).split(',')[1])
                        await asyncio.sleep(0.12)
                        await route.fulfill(content_type='image/jpeg', body=photo)
                    finally:
                        active -= 1
                elif parsed.netloc != urlsplit(BASE_URL).netloc:
                    await route.abort()
                elif parsed.path == '/api/gemini/status':
                    await route.fulfill(json={'configured': True, 'personalKeySupported': True})
                else:
                    await route.continue_()

            await context.route('**/*', intercept)
            try:
                await page.goto(BASE_URL, wait_until='domcontentloaded')
                await expect(page.locator('article')).to_have_count(24)
                first_image = page.locator('article').first.get_by_alt_text('名片縮圖', exact=True)
                await expect(first_image).to_be_visible()
                await first_image.evaluate('image => image.decode()')
                await page.wait_for_function("[...document.querySelectorAll('article img')].filter(i => i.complete && i.naturalWidth > 0).length >= 3")
                metrics = await page.evaluate("""() => {
                  const cards = [...document.querySelectorAll('article')].map(el => el.getBoundingClientRect());
                  const main = document.querySelector('[aria-label="名片瀏覽區"]').getBoundingClientRect();
                  return {width: innerWidth, columns: cards.filter(r => r.top === cards[0].top).length,
                    firstHeight: cards[0].height, fullVisible: cards.filter(r => r.top >= main.top && r.bottom <= main.bottom).length,
                    left: cards[0].left, right: cards.filter(r => r.top === cards[0].top).at(-1).right,
                    overflow: document.documentElement.scrollWidth > innerWidth};
                }""")
                assert not metrics['overflow'], metrics
                assert metrics['left'] <= 12 and metrics['right'] >= width - 28, metrics
                assert metrics['firstHeight'] <= 210, metrics
                assert metrics['columns'] == (4 if width > 600 else 1), metrics
                assert metrics['fullVisible'] >= (12 if width > 600 else 3), metrics
                await page.wait_for_function("count => [...document.querySelectorAll('article')].slice(0, count).every(el => { const image = el.querySelector('img'); return image?.complete && image.naturalWidth > 0; })", arg=metrics['fullVisible'])
                assert peak <= 4 and 3 <= len(requests) < 40, (peak, len(requests))
                assert len(set(requests)) == len(requests), 'A displayed photo should not redownload during sync/cache updates'
                measurements.append({**metrics, 'download_peak': peak, 'initial_photo_requests': len(requests)})
                await page.screenshot(path=str(OUTPUT / f'cards-{width}.png'))
                mark(f'{width}px: full-width compact cards with automatic visible photos, bounded downloads and no overflow')

                await page.get_by_role('button', name='資料管理與設定', exact=True).click()
                toolbar = await page.get_by_label('新增與檢視', exact=True).bounding_box()
                assert toolbar and toolbar['height'] <= (46 if width > 600 else 54), toolbar
                boxes = [await page.get_by_role('button', name=name, exact=True).bounding_box() for name in ['手動新增名片', '卡片檢視', '列表檢視']]
                assert max(box['y'] for box in boxes) - min(box['y'] for box in boxes) <= 1, boxes
                await expect(page.get_by_role('button', name='AI 辨識設定', exact=True)).to_be_visible()
                await page.screenshot(path=str(OUTPUT / f'tools-{width}.png'))
                await page.get_by_role('button', name='資料管理與設定', exact=True).click()
                mark(f'{width}px: manual entry and view controls share one short row; API key settings remain accessible')

                first = page.locator('article').first
                await first.get_by_role('button', name='展開 合成聯絡人 001 的詳細資訊', exact=True).click()
                await expect(first.get_by_text('合成市測試區測試路 123 號 10 樓', exact=True)).to_be_visible()
                await expect(first.locator('p').filter(has_text='詳細備註完整保留。')).to_contain_text('跨部門合作專案')
                await first.get_by_role('button', name='收合 合成聯絡人 001 的詳細資訊', exact=True).click()
                mark(f'{width}px: full address and long notes remain available through the details control')

                if width > 600:
                    await page.set_viewport_size({'width': 1920, 'height': 1080})
                    await page.wait_for_function("getComputedStyle(document.querySelector('article').parentElement).gridTemplateColumns.split(' ').length === 6")
                    await page.screenshot(path=str(OUTPUT / 'cards-1920.png'))
                    mark('1920px: the layout uses six columns instead of leaving broad unused margins')
                assert not errors, errors
            except BaseException:
                await page.screenshot(path=str(OUTPUT / f'failure-{width}.png'))
                raise
            finally:
                await context.close()
        await browser.close()
    (OUTPUT / 'browser-density-smoke.json').write_text(json.dumps({'passed': checks, 'measurements': measurements}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
