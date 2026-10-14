"""Google sync integration with a fully synthetic browser OAuth/Sheets client.

Run: BASE_URL=http://127.0.0.1:3100 python3 tests/browser-sync-smoke.py
Requires Python Playwright and system Chromium. Every external request is blocked
except synthetic userinfo responses fulfilled locally by Playwright.
"""
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright, expect

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3100').rstrip('/')
OUTPUT = Path(os.environ.get('TEST_RESULTS_DIR', 'test-results'))
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
MOCK = r"""(() => {
  const headers = ['id', 'name', 'company', 'title', 'phone', 'email', 'address', 'notes', 'timestamp', 'imageDriveId', 'rawText', 'contactMeta'];
  const localCard = { id: 'local-one', name: '未綁定本機', company: '合成公司', title: '', phone: '', email: '', address: '', notes: '', rawText: '只用於整合測試', timestamp: 100 };
  if (!sessionStorage.getItem('sync-smoke-seeded')) {
    localStorage.setItem('business-cards-db', JSON.stringify([localCard]));
    sessionStorage.setItem('sync-smoke-seeded', 'true');
  }
  const mock = window.__cloud = {
    nextAccount: 'a', token: null, rows: { a: [headers], b: [headers] }, events: [], writes: [],
    failDelete: 0, holdNextRead: false, readHeld: false, releaseRead: null, callback: null,
    authenticate(account) { this.callback({ access_token: `test-token-${account}`, expires_in: 3600 }); },
  };
  const owner = () => {
    const match = mock.token?.access_token.match(/^test-token-([ab])$/);
    if (!match) throw new Error('Synthetic Google token missing');
    return match[1];
  };
  const checkOwner = args => {
    const account = owner();
    if (args.spreadsheetId !== `${account}-sheet`) throw new Error('Cross-account spreadsheet operation');
    return account;
  };
  const readSnapshot = async () => new Promise((resolve, reject) => {
    const open = indexedDB.open('business-card-keeper', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('snapshots', 'readonly');
      const request = tx.objectStore('snapshots').get('current');
      tx.oncomplete = () => { db.close(); resolve(request.result); };
    };
  });
  const auditWrite = async (account, row, action) => {
    const persisted = await readSnapshot();
    const stored = persisted?.cards.find(card => card.id === row[0]);
    const bound = stored?.cloudAccount === `${account}@example.invalid`;
    mock.writes.push({ account, id: row[0], name: row[1], action, boundBeforeWrite: bound });
    if (!bound) throw new Error('Card account ownership was not durable before cloud write');
  };
  window.gapi = {
    load: (_name, options) => options.callback(),
    client: {
      init: async () => {}, getToken: () => mock.token, setToken: token => { mock.token = token; },
      drive: { files: {
        list: async args => {
          const account = owner(); mock.events.push({ action: 'list', account });
          if (args.q.includes("mimeType='application/vnd.google-apps.spreadsheet'")) return { result: { files: [{ id: `${account}-sheet` }] } };
          if (args.q.includes("mimeType='application/vnd.google-apps.folder'")) return { result: { files: [{ id: `${account}-folder` }] } };
          return { result: { files: [] } };
        },
        create: async () => { throw new Error('Unexpected Drive create in browser smoke'); },
        delete: async () => { throw new Error('Unexpected Drive delete in text-only smoke'); },
      } },
      sheets: { spreadsheets: {
        get: async args => { checkOwner(args); return { result: { sheets: [{ properties: { title: '名片資料', sheetId: 17 } }] } }; },
        values: {
          get: async args => {
            const account = checkOwner(args);
            if (args.range.endsWith('!K1')) return { result: { values: [['rawText']] } };
            if (args.range.endsWith('!L1')) return { result: { values: [['contactMeta']] } };
            mock.events.push({ action: 'read', account });
            const values = structuredClone(mock.rows[account].slice(1));
            if (mock.holdNextRead) {
              mock.holdNextRead = false; mock.readHeld = true;
              await new Promise(resolve => { mock.releaseRead = () => { mock.readHeld = false; resolve(); }; });
            }
            return { result: { values } };
          },
          append: async args => {
            const account = checkOwner(args);
            for (const row of args.resource.values) { await auditWrite(account, row, 'append'); mock.rows[account].push([...row]); }
          },
          update: async args => {
            const account = checkOwner(args);
            const index = Number(args.range.match(/!A(\d+)/)?.[1]) - 1;
            if (index < 1 || !Number.isFinite(index)) throw new Error('Unexpected update range');
            const row = args.resource.values[0];
            await auditWrite(account, row, 'update'); mock.rows[account][index] = [...row];
          },
        },
        batchUpdate: async args => {
          const account = checkOwner(args);
          mock.events.push({ action: 'delete', account, failed: mock.failDelete > 0 });
          if (mock.failDelete > 0) { mock.failDelete--; throw { status: 503, result: { error: { message: 'Synthetic deletion failure' } } }; }
          for (const request of args.resource.requests) {
            const range = request.deleteDimension.range;
            mock.rows[account].splice(range.startIndex, range.endIndex - range.startIndex);
          }
        },
      } },
    },
  };
  window.google = { accounts: { oauth2: { initTokenClient: options => {
    mock.callback = options.callback;
    return { requestAccessToken: () => mock.authenticate(mock.nextAccount) };
  } } } };
})();"""

async def wait_snapshot(page, predicate, argument=None):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        result = await page.evaluate(
            f"async argument => {{ const state = await ({READ_SNAPSHOT})(); return ({predicate})(state, argument) ? state : null; }}", argument)
        if result is not None:
            return result
        await asyncio.sleep(0.05)
    raise AssertionError(f'IndexedDB did not satisfy: {predicate}')

async def tool_action(page, name):
    action = page.get_by_role('button', name=name, exact=True)
    if not await action.is_visible():
        await page.get_by_role('button', name='資料管理與設定', exact=True).click()
    await expect(action).to_be_enabled()
    await action.click()


async def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed, page_errors, blocked = [], [], set()
    failure = None
    userinfo_seen = asyncio.Event()
    delay_b_profile = False
    def mark(label):
        passed.append(label)
        print(f'PASS {label}', flush=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
        context = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        await context.add_init_script(MOCK)
        async def intercept(route):
            parsed = urlsplit(route.request.url)
            if parsed.hostname == 'www.googleapis.com' and parsed.path == '/oauth2/v3/userinfo':
                token = route.request.headers.get('authorization', '')
                account = token[-1]
                assert account in ('a', 'b') and token == f'Bearer test-token-{account}'
                if account == 'b' and delay_b_profile:
                    userinfo_seen.set()
                    await asyncio.sleep(1.8)
                await route.fulfill(json={'name': f'測試帳號 {account.upper()}', 'email': f'{account}@example.invalid', 'picture': ''})
            elif parsed.netloc != urlsplit(BASE_URL).netloc:
                blocked.add(parsed.hostname)
                await route.abort()
            elif parsed.path == '/api/gemini/status':
                await route.fulfill(json={'configured': True})
            else:
                await route.continue_()
        await context.route('**/*', intercept)
        page = await context.new_page()
        page.set_default_timeout(15_000)
        page.on('pageerror', lambda error: page_errors.append(str(error)))
        try:
            await page.goto(BASE_URL, wait_until='domcontentloaded')
            await expect(page.get_by_role('heading', name='未綁定本機', exact=True)).to_be_visible()
            await wait_snapshot(page, 'state => state.cards.length === 1 && !state.cards[0].cloudAccount')
            await tool_action(page, '登入並自動同步')
            await page.wait_for_function("window.__cloud.rows.a.length === 2")
            snapshot = await wait_snapshot(page, "state => state.cards[0]?.cloudAccount === 'a@example.invalid' && state.cards[0].lastSyncedSheetId === 'a-sheet'")
            writes = await page.evaluate('window.__cloud.writes')
            assert len(writes) == 1 and writes[0]['boundBeforeWrite']
            assert await page.evaluate("localStorage.getItem('KEEPER_GOOGLE_AUTH') === null")
            mark('login durably binds local cards before automatic upload and keeps tokens out of localStorage')

            await expect(page.get_by_role('status', name='本機已儲存 · 已與 Google 同步', exact=True)).to_be_visible()
            # One follow-up can normalize legacy empty optional fields. Require
            # a sustained idle window rather than assuming the first status is final.
            deadline = time.monotonic() + 12
            count = await page.evaluate('window.__cloud.events.length')
            unchanged_since = time.monotonic()
            while time.monotonic() - unchanged_since < 2.5:
                assert time.monotonic() < deadline, 'Automatic sync never settled'
                await asyncio.sleep(0.25)
                latest = await page.evaluate('window.__cloud.events.length')
                if latest != count:
                    count = latest
                    unchanged_since = time.monotonic()
            mark('unchanged cards settle without a continuous automatic sync loop')

            await page.evaluate('window.__cloud.holdNextRead = true')
            await tool_action(page, '立即同步')
            await page.wait_for_function('window.__cloud.readHeld')
            await page.get_by_role('button', name='編輯 未綁定本機 的名片', exact=True).click()
            await page.get_by_label('姓名', exact=True).fill('同步期間修改')
            await page.get_by_role('button', name='儲存變更', exact=True).click()
            await wait_snapshot(page, "state => state.cards[0].name === '同步期間修改'")
            await page.evaluate('window.__cloud.releaseRead()')
            await page.wait_for_function("window.__cloud.rows.a[1]?.[1] === '同步期間修改'")
            snapshot = await wait_snapshot(page, "state => state.cards[0].name === '同步期間修改' && state.cards[0].lastSyncedAt === state.cards[0].timestamp")
            assert snapshot['cards'][0]['cloudAccount'] == 'a@example.invalid'
            mark('editing while a cloud read is delayed preserves the latest local edit and uploads it next')

            await page.evaluate('window.__cloud.failDelete = 1')
            await page.get_by_role('button', name='刪除 同步期間修改 的名片', exact=True).click()
            await page.get_by_role('button', name='確定刪除', exact=True).click()
            await page.wait_for_function("window.__cloud.events.some(event => event.action === 'delete' && event.failed)")
            snapshot = await wait_snapshot(page, 'state => state.cards.length === 0 && state.deletions.length === 1')
            assert snapshot['deletions'][0]['account'] == 'a@example.invalid'
            assert await page.evaluate('window.__cloud.rows.a.length') == 2
            await page.get_by_role('button', name='關閉提示', exact=True).click()
            await tool_action(page, '立即同步')
            await wait_snapshot(page, 'state => state.cards.length === 0 && state.deletions.length === 0')
            assert await page.evaluate('window.__cloud.rows.a.length') == 1
            mark('failed cloud deletion retains a durable tombstone and retry removes it without resurrection')

            # Keep one A-only contact for the account-switch isolation check.
            await tool_action(page, '手動新增名片')
            await page.get_by_label('姓名', exact=True).fill('帳號 A 私有名片')
            await page.get_by_role('button', name='建立名片', exact=True).click()
            await page.wait_for_function("window.__cloud.rows.a.some(row => row[1] === '帳號 A 私有名片')")
            await wait_snapshot(page, "state => state.cards.some(card => card.name === '帳號 A 私有名片' && card.lastSyncedSheetId === 'a-sheet')")
            delay_b_profile = True
            await page.evaluate("window.__cloud.authenticate('b'); document.dispatchEvent(new Event('visibilitychange'))")
            await asyncio.wait_for(userinfo_seen.wait(), timeout=5)
            # A timer/focus event must not pair A's local state with B's new token.
            await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
            await page.wait_for_function("window.__cloud.events.some(event => event.account === 'b' && event.action === 'read')")
            assert await page.evaluate('window.__cloud.rows.b.length') == 1
            assert not [w for w in await page.evaluate('window.__cloud.writes') if w['account'] == 'b']
            await expect(page.get_by_role('heading', name='帳號 A 私有名片', exact=True)).to_have_count(0)
            snapshot = await page.evaluate(READ_SNAPSHOT)
            assert any(c['name'] == '帳號 A 私有名片' and c['cloudAccount'] == 'a@example.invalid' for c in snapshot['cards'])
            mark('account switch with delayed userinfo never uploads or shows the previous account cards')

            await tool_action(page, '手動新增名片')
            await page.get_by_label('姓名', exact=True).fill('帳號 B 私有名片')
            await page.get_by_role('button', name='建立名片', exact=True).click()
            await page.wait_for_function("window.__cloud.rows.b.some(row => row[1] === '帳號 B 私有名片')")
            await wait_snapshot(page, "state => state.cards.some(card => card.name === '帳號 B 私有名片' && card.lastSyncedSheetId === 'b-sheet')")
            writes = await page.evaluate('window.__cloud.writes')
            assert all(w['boundBeforeWrite'] for w in writes)
            assert all(w['name'] != '帳號 A 私有名片' for w in writes if w['account'] == 'b')
            assert all(w['name'] != '帳號 B 私有名片' for w in writes if w['account'] == 'a')
            await tool_action(page, '登出')
            await expect(page.get_by_role('heading', name='帳號 A 私有名片', exact=True)).to_be_visible()
            await expect(page.get_by_role('heading', name='帳號 B 私有名片', exact=True)).to_be_visible()
            assert await page.evaluate("sessionStorage.getItem('KEEPER_GOOGLE_AUTH') === null && window.__cloud.token === null")
            mark('new cards stay scoped to their account and logout preserves both local copies while clearing the token')

            await page.screenshot(path=str(OUTPUT / 'mobile-sync-smoke.png'))
            assert not page_errors, page_errors
            mark('no uncaught browser errors in the synthetic OAuth and sync workflow')
        except Exception as error:
            failure = f'{type(error).__name__}: {error}'
            await page.screenshot(path=str(OUTPUT / 'mobile-sync-failure.png'))
            raise
        finally:
            report = {
                'base_url': BASE_URL, 'passed': passed, 'failure': failure,
                'page_errors': page_errors, 'blocked_external_hosts': sorted(blocked),
                'cloud_writes': await page.evaluate('window.__cloud?.writes || []'),
                'cloud_events': await page.evaluate('window.__cloud?.events || []'),
            }
            (OUTPUT / 'browser-sync-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False), flush=True)
            await context.close()
            await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
