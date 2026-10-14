"""Mobile contact workflow with synthetic contacts and Google APIs; no live credentials.
Run: BASE_URL=http://127.0.0.1:3100 python3 tests/browser-contact-workflow.py
"""
import asyncio
import base64
import json
import os
import runpy
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo
from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3100').rstrip('/')
OUTPUT = Path(os.environ.get('TEST_RESULTS_DIR', 'test-results'))
SYNC = runpy.run_path(str(Path(__file__).with_name('browser-sync-smoke.py')))
SCAN = runpy.run_path(str(Path(__file__).with_name('browser-scan-smoke.py')))
MOCK, READ_SNAPSHOT, wait_snapshot = SYNC['MOCK'], SYNC['READ_SNAPSHOT'], SCAN['wait_snapshot']

async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed, errors = [], []
    def mark(label):
        passed.append(label)
        print(f'PASS {label}', flush=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
        async def context():
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, timezone_id='Asia/Taipei', accept_downloads=True)
            await ctx.add_init_script(MOCK)
            await ctx.add_init_script("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('test', 'NotAllowedError'); };")
            async def route(request):
                url = urlsplit(request.request.url)
                if url.hostname == 'www.googleapis.com' and url.path == '/oauth2/v3/userinfo':
                    await request.fulfill(json={'name': 'Synthetic owner', 'email': 'a@example.invalid', 'picture': ''})
                elif url.netloc != urlsplit(BASE_URL).netloc:
                    await request.abort()
                elif url.path == '/api/gemini/status':
                    await request.fulfill(json={'configured': True})
                elif url.path == '/api/gemini/scan':
                    await request.fulfill(json={'structuredData': {'name': '活動掃描', 'company': '測試公司', 'title': '', 'phone': '', 'email': '', 'address': '', 'notes': '', 'rawText': '合成掃描'}})
                else:
                    await request.continue_()
            await ctx.route('**/*', route)
            return ctx

        async def open_page(ctx):
            page = await ctx.new_page()
            page.set_default_timeout(15000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto(BASE_URL, wait_until='domcontentloaded')
            await expect(page.get_by_role('heading', name='名片管家', exact=True)).to_be_visible()
            return page

        async def tools(page, label):
            await page.get_by_role('button', name='資料管理與設定', exact=True).click()
            await page.get_by_role('button', name=label, exact=True).click()

        async def layout(page):
            assert await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow'
            dialog = page.get_by_role('dialog')
            if await dialog.count():
                assert await dialog.evaluate('(el) => el.scrollWidth <= el.clientWidth'), 'Dialog horizontal overflow'

        ctx = await context()
        page = await open_page(ctx)
        try:
            await tools(page, '活動模式')
            await page.get_by_label('認識場合／活動', exact=True).fill('自動化展')
            await page.get_by_label('標籤', exact=True).fill('供應商、重要')
            await page.get_by_role('button', name='套用到接下來的名片', exact=True).click()
            await tools(page, '手動新增名片')
            await expect(page.get_by_label('認識場合／活動', exact=True)).to_have_value('自動化展')
            await page.get_by_label('姓名', exact=True).fill('王小明')
            await page.get_by_label('公司', exact=True).fill('原公司')
            await page.get_by_label('職稱', exact=True).fill('經理')
            await page.get_by_label('電話', exact=True).fill('0912-345-678')
            await page.get_by_label('Email', exact=True).fill('person@example.invalid')
            await page.get_by_role('button', name='建立名片', exact=True).click()
            await wait_snapshot(page, "s => s.cards.some(c => c.name === '王小明' && c.events?.[0] === '自動化展' && c.tags.length === 2)")
            mark('event mode applies labels to manual contacts and commits them')

            await page.get_by_role('button', name='跟進與紀錄：王小明', exact=True).click()
            await page.get_by_label('下次要做什麼', exact=True).fill('寄產品型錄')
            today = datetime.now(ZoneInfo('Asia/Taipei')).strftime('%Y-%m-%d')
            await page.get_by_label('預定日期', exact=True).fill(today)
            await page.get_by_role('button', name='新增待辦', exact=True).click()
            await expect(page.get_by_role('link', name='加入 Google 行事曆')).to_have_attribute('href', __import__('re').compile('https://calendar.google.com/calendar/render\\?'))
            await page.get_by_label('這次聊了什麼', exact=True).fill('想了解視覺檢測方案')
            await page.get_by_role('button', name='新增互動紀錄', exact=True).click()
            await page.get_by_role('checkbox', name='完成待辦：寄產品型錄', exact=True).check()
            await wait_snapshot(page, "s => s.cards.find(c => c.name === '王小明').followUps[0].completedAt > 0")
            await page.get_by_role('checkbox', name='完成待辦：寄產品型錄', exact=True).uncheck()
            await wait_snapshot(page, "s => s.cards.find(c => c.name === '王小明').followUps[0].completedAt === undefined && s.cards.find(c => c.name === '王小明').interactions.length === 1")
            await layout(page)
            await page.get_by_role('dialog').evaluate('(el) => el.scrollTop = 0')
            await page.screenshot(path=str(OUTPUT / 'contact-workspace-mobile.png'), full_page=True)
            await page.get_by_role('button', name='關閉面板', exact=True).click()
            await page.get_by_role('button', name='結束活動模式', exact=True).click()
            mark('follow-ups, completion/reopen, calendar link and interaction history work on mobile')

            await page.reload(wait_until='domcontentloaded')
            await page.get_by_role('button', name='待跟進 1', exact=True).click()
            await page.get_by_role('button', name='今天', exact=True).click()
            await expect(page.get_by_text('寄產品型錄', exact=True)).to_be_visible()
            await page.get_by_role('button', name='關閉面板', exact=True).click()
            await page.get_by_role('button', name='顯示或隱藏搜尋選項').click()
            await page.get_by_label('依場合篩選', exact=True).select_option('自動化展')
            await expect(page.locator('article')).to_have_count(1)
            await page.get_by_label('依標籤篩選', exact=True).select_option('供應商')
            await expect(page.locator('article')).to_have_count(1)
            await page.get_by_role('button', name='清除標籤與場合', exact=True).click()
            await page.get_by_role('button', name='顯示或隱藏搜尋選項').click()
            await page.get_by_label('搜尋名片', exact=True).fill('視覺檢測')
            await expect(page.locator('article')).to_have_count(1)
            await page.get_by_label('搜尋名片', exact=True).fill('')
            mark('reload preserves contact history and filters/search include the new fields')

            await tools(page, '手動新增名片')
            await page.get_by_label('姓名', exact=True).fill('王小明')
            await page.get_by_label('公司', exact=True).fill('新公司')
            await page.get_by_label('職稱', exact=True).fill('總監')
            await page.get_by_label('電話', exact=True).fill('+886 912 345 678')
            await page.get_by_label('Email', exact=True).fill('person@example.invalid')
            await page.get_by_label('認識場合／活動', exact=True).fill('交流會')
            await page.get_by_role('button', name='建立名片', exact=True).click()
            await page.get_by_role('button', name='可能重複 1 組', exact=True).click()
            await page.get_by_role('button', name='比較 王小明 與 王小明', exact=True).click()
            merge_button = page.get_by_role('button', name='確認合併，保留兩張原始名片', exact=True)
            await expect(merge_button).to_be_disabled()
            # Newest contact appears first: select new company/title and preserve both phone formats.
            await page.get_by_role('radio', name='公司：使用名片 1', exact=True).check()
            await page.get_by_role('radio', name='職稱：使用名片 1', exact=True).check()
            await page.get_by_role('radio', name='電話兩者都保留', exact=True).check()
            await layout(page)
            await page.screenshot(path=str(OUTPUT / 'contact-merge-mobile.png'), full_page=True)
            await merge_button.click()
            state = await wait_snapshot(page, 's => s.cards.length === 4 && s.cards.filter(c => c.mergedIntoId).length === 2')
            merged = next(c for c in state['cards'] if c.get('followUps') and not c.get('mergedIntoId'))
            assert merged['company'] == '新公司'
            assert set(merged['events']) == {'自動化展', '交流會'}
            assert len(merged['interactions']) == 1
            assert state['deletions'] == []
            await page.get_by_role('button', name='關閉面板', exact=True).click()
            await expect(page.locator('article')).to_have_count(2)
            await page.reload(wait_until='domcontentloaded')
            await expect(page.locator('article')).to_have_count(2)
            mark('merge requires conflict choices and preserves both source records across reload')

            async with page.expect_download() as backup:
                await tools(page, '建立完整備份 (含圖片)')
            backup_path = OUTPUT / 'contact-workflow-backup.json'
            await (await backup.value).save_as(str(backup_path))
            backup_cards = json.loads(backup_path.read_text())
            assert len(backup_cards) == 4
            assert len([c for c in backup_cards if c.get('mergedIntoId')]) == 2
            async with page.expect_download() as excel:
                await tools(page, '匯出為 Excel (僅文字)')
            excel_path = OUTPUT / 'contact-workflow-export.xlsx'
            await (await excel.value).save_as(str(excel_path))
            mark('full JSON backup includes merge originals and Excel export downloads')

            restore_ctx = await context()
            restore_page = await open_page(restore_ctx)
            await restore_page.locator('input[accept=".json"]').set_input_files(str(backup_path))
            await restore_page.get_by_role('button', name='確定還原', exact=True).click()
            await wait_snapshot(restore_page, 's => s.cards.length === 4 && s.cards.filter(c => c.mergedIntoId).length === 2')
            await expect(restore_page.locator('article')).to_have_count(2)
            await restore_ctx.close()
            excel_ctx = await context()
            excel_page = await open_page(excel_ctx)
            await excel_page.locator('input[accept=".xlsx,.xls"]').set_input_files(str(excel_path))
            await wait_snapshot(excel_page, "s => s.cards.some(c => c.company === '新公司' && c.followUps?.length === 1 && c.interactions?.length === 1 && c.events?.length === 2)")
            await excel_ctx.close()
            mark('actual exported JSON and Excel restore context and tasks in fresh browsers')

            await page.get_by_role('button', name='跟進與紀錄：王小明', exact=True).click()
            await page.get_by_text('查看合併前的 2 張名片', exact=True).click()
            await page.get_by_role('button', name='還原原始名片：王小明', exact=True).first.click()
            await wait_snapshot(page, 's => s.cards.filter(c => c.mergedIntoId).length === 1')
            await expect(page.locator('article')).to_have_count(3)
            mark('restoring an original keeps the merged result and all history')

            await tools(page, '登入並自動同步')
            await page.wait_for_function("window.__cloud.rows.a.length === 5 && window.__cloud.rows.a.slice(1).filter(row => row[11]).length === 3")
            rows = await page.evaluate('window.__cloud.rows.a')
            assert any(json.loads(row[11]).get('followUps') for row in rows[1:] if row[11])
            assert all(write['boundBeforeWrite'] for write in await page.evaluate('window.__cloud.writes'))
            mark('Google sync writes contact metadata and archived originals after durable account binding')

            # Reconstruct an independent device from only cloud rows.
            remote_ctx = await context()
            await remote_ctx.add_init_script('window.__cloud.rows.a = ' + json.dumps(rows, ensure_ascii=False) + ';')
            remote_page = await open_page(remote_ctx)
            await tools(remote_page, '登入並自動同步')
            await wait_snapshot(remote_page, "s => s.cards.some(c => c.company === '新公司' && c.followUps?.length === 1 && !c.mergedIntoId)")
            await expect(remote_page.locator('article')).to_have_count(3)
            await remote_ctx.close()
            mark('a second device reads tags, tasks and merge state from cloud without reviving archived sources')

            scan_ctx = await context()
            scan_page = await open_page(scan_ctx)
            await tools(scan_page, '活動模式')
            await scan_page.get_by_label('認識場合／活動', exact=True).fill('掃描活動')
            await scan_page.get_by_label('標籤', exact=True).fill('本次名片')
            await scan_page.get_by_role('button', name='套用到接下來的名片', exact=True).click()
            await scan_page.get_by_role('button', name='掃描新名片', exact=True).click()
            data = await scan_page.evaluate("() => { const c = document.createElement('canvas'); c.width = 800; c.height = 500; const x = c.getContext('2d'); x.fillStyle='white'; x.fillRect(0,0,800,500); x.fillStyle='black'; x.font='40px sans-serif'; x.fillText('Synthetic Contact',50,100); return c.toDataURL('image/png').split(',')[1]; }")
            await scan_page.locator('input[type=file][multiple]').set_input_files({'name': 'card.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(data)})
            await wait_snapshot(scan_page, "s => s.cards.some(c => c.name === '活動掃描' && c.events?.[0] === '掃描活動' && c.tags?.[0] === '本次名片' && c.needsReview && !c.isProcessing)")
            mark('event labels survive asynchronous gallery OCR without being overwritten')
            await scan_page.get_by_role('button', name='完成', exact=False).first.click()
            await tools(scan_page, '手動新增名片')
            await scan_page.get_by_label('姓名', exact=True).fill('活動掃描')
            await scan_page.get_by_label('公司', exact=True).fill('測試公司')
            await scan_page.get_by_role('button', name='建立名片', exact=True).click()
            await scan_page.get_by_role('button', name='可能重複 1 組', exact=True).click()
            await scan_page.get_by_role('button', name='比較 活動掃描 與 活動掃描', exact=True).click()
            await scan_page.get_by_role('button', name='確認合併，保留兩張原始名片', exact=True).click()
            photo_state = await wait_snapshot(scan_page, 's => s.cards.filter(c => c.mergedIntoId).length === 2')
            photo_cards = [c for c in photo_state['cards'] if c.get('imageBase64')]
            assert len(photo_cards) == 2
            assert photo_cards[0]['imageBase64'] == photo_cards[1]['imageBase64']
            await scan_ctx.close()
            mark('photo merge retains the captured original and a full-quality merged copy')
            await layout(page)
            assert not errors, errors
            mark('mobile dialogs fit the viewport and emit no browser runtime errors')
        finally:
            await ctx.close()
            await browser.close()
            (OUTPUT / 'contact-workflow-results.json').write_text(json.dumps({'passed': passed, 'page_errors': errors}, ensure_ascii=False, indent=2))
    print(f'{len(passed)} workflow checks passed', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
