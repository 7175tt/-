"""Bring-your-own Gemini key UI with synthetic credentials and local HTTP stubs.

Run: BASE_URL=http://127.0.0.1:3000 python3 tests/browser-api-key-smoke.py
Requires Python Playwright and Chromium. No real keys or remote AI calls are used.
"""
import base64
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('BASE_URL', 'http://127.0.0.1:3000').rstrip('/')
OUTPUT = Path(os.environ.get('TEST_RESULTS_DIR', 'test-results'))
KEY_NAME = 'business-card-keeper:gemini-api-key'
VALID = 'synthetic-valid-gemini-key-000000001'
INVALID = 'synthetic-invalid-gemini-key-0000001'
QUOTA = 'synthetic-quota-gemini-key-000000001'
REPLACEMENT = 'synthetic-replacement-gemini-key-01'
SECRETS = (VALID, INVALID, QUOTA, REPLACEMENT)
READ_SNAPSHOT = """() => new Promise((resolve, reject) => {
  const open = indexedDB.open('business-card-keeper', 1);
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction('snapshots', 'readonly');
    const get = tx.objectStore('snapshots').get('current');
    tx.oncomplete = () => { db.close(); resolve(get.result); };
  };
})"""


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    passed, page_errors, api_calls, external_hosts = [], [], [], set()
    failure = None
    scan_control = {'hold': False, 'held': []}

    def mark(label):
        passed.append(label)
        print(f'PASS {label}', flush=True)

    def safe_kind(key):
        return {VALID: 'valid-synthetic', INVALID: 'invalid-synthetic', QUOTA: 'quota-synthetic', REPLACEMENT: 'replacement-synthetic'}.get(key, 'absent' if not key else 'unexpected')

    def intercept(route):
        request = route.request
        parsed = urlsplit(request.url)
        if parsed.netloc != urlsplit(BASE_URL).netloc:
            external_hosts.add(parsed.hostname)
            route.abort()
            return
        if not parsed.path.startswith('/api/gemini/'):
            route.continue_()
            return
        key = request.headers.get('x-gemini-api-key')
        assert not any(secret in request.url for secret in SECRETS), 'Key must never enter a URL'
        assert not any(secret in (request.post_data or '') for secret in SECRETS), 'Key must never enter JSON request bodies'
        api_calls.append({'path': parsed.path, 'method': request.method, 'key': safe_kind(key)})
        if parsed.path == '/api/gemini/status':
            assert key is None, 'Readiness GET must not send a personal credential'
            route.fulfill(json={'configured': False, 'personalKeySupported': True})
            return
        assert request.method == 'POST'
        if key == INVALID:
            route.fulfill(status=401, json={'code': 'INVALID_API_KEY', 'error': '金鑰無效，請確認後重試。'})
        elif key == QUOTA:
            route.fulfill(status=429, json={'code': 'RATE_LIMITED', 'error': '這組金鑰的額度已用完，請稍後重試。'})
        elif key not in (VALID, REPLACEMENT):
            route.fulfill(status=401, json={'code': 'API_KEY_REQUIRED', 'error': '請先設定自己的 Gemini API 金鑰。'})
        elif parsed.path == '/api/gemini/check-key':
            route.fulfill(json={'valid': True, 'model': 'synthetic-gemini-model'})
        elif parsed.path == '/api/gemini/scan':
            assert set(request.post_data_json) == {'base64Image'}
            if scan_control['hold']:
                scan_control['hold'] = False
                scan_control['held'].append(route)
                return
            route.fulfill(json={'structuredData': {
                'name': '更換金鑰後的名片' if key == REPLACEMENT else '個人金鑰測試名片', 'company': '合成資料公司', 'title': '測試員',
                'phone': '0912345678', 'email': 'synthetic@example.invalid', 'address': '',
                'notes': '不含真實個人資料', 'rawText': '個人金鑰測試名片\n合成資料公司',
            }})
        else:
            raise AssertionError(f'Unexpected synthetic API path: {parsed.path}')

    def open_settings(page):
        page.get_by_role('button', name='資料管理與設定', exact=True).click()
        page.get_by_role('button', name='AI 辨識設定', exact=True).click()
        expect(page.get_by_role('heading', name='AI 辨識設定', exact=True)).to_be_visible()
        return page.get_by_label('Gemini API 金鑰', exact=True)

    def close_settings(page):
        page.get_by_role('button', name='關閉設定', exact=True).click()

    def storage(page):
        return page.evaluate('name => ({ session: sessionStorage.getItem(name), local: localStorage.getItem(name) })', KEY_NAME)

    def wait_saved(page, expected):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if storage(page) == expected:
                return
            page.wait_for_timeout(50)
        raise AssertionError('Credential was not saved in the selected storage scope')

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH', '/usr/bin/chromium'), headless=True)
        context = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, accept_downloads=True)
        context.route('**/*', intercept)
        context.add_init_script("""navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException('Synthetic camera denial', 'NotAllowedError');
        };
        window.__abortedScans = 0;
        const originalFetch = window.fetch;
        window.fetch = (input, init) => {
          if (String(input).endsWith('/api/gemini/scan')) {
            init?.signal?.addEventListener('abort', () => { window.__abortedScans++; }, { once: true });
          }
          return originalFetch.call(window, input, init);
        };""")
        def new_page():
            page = context.new_page()
            page.set_default_timeout(15_000)
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.on('dialog', lambda dialog: dialog.accept())
            page.goto(BASE_URL, wait_until='domcontentloaded')
            expect(page.get_by_role('button', name='資料管理與設定', exact=True)).to_be_visible()
            return page
        page = new_page()
        try:
            field = open_settings(page)
            expect(field).to_have_value('')
            expect(field).to_have_attribute('type', 'password')
            expect(page.get_by_label('在此裝置記住金鑰', exact=True)).not_to_be_checked()
            assert storage(page) == {'session': None, 'local': None}
            assert all(call['method'] == 'GET' for call in api_calls)
            for width in (390, 320):
                page.set_viewport_size({'width': width, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
                assert page.get_by_role('dialog').evaluate('panel => panel.scrollWidth <= panel.clientWidth')
                page.screenshot(path=str(OUTPUT / f'mobile-api-key-settings-{width}.png'))
            page.set_viewport_size({'width': 390, 'height': 844})
            mark('missing shared server key opens personal settings with masked input and session-only default')

            field.fill(VALID)
            page.get_by_role('button', name='儲存金鑰', exact=True).click()
            wait_saved(page, {'session': VALID, 'local': None})
            expect(field).to_have_attribute('type', 'password')
            close_settings(page)
            page.reload(wait_until='domcontentloaded')
            field = open_settings(page)
            expect(field).to_have_value(VALID)
            assert storage(page)['local'] is None
            mark('default key save survives reload within the same tab without persistent localStorage')

            page.get_by_role('button', name='測試連線', exact=True).click()
            page.wait_for_timeout(100)
            expect(page.get_by_role('status').filter(has_text='測試成功，這把金鑰目前可以使用。')).to_be_visible()
            for candidate, kind, message in [(INVALID, 'invalid-synthetic', '金鑰無效'), (QUOTA, 'quota-synthetic', '配額不足')]:
                field.fill(candidate)
                before = len(api_calls)
                page.get_by_role('button', name='測試連線', exact=True).click()
                expect(page.get_by_role('alert').filter(has_text=message)).to_be_visible()
                calls = [call for call in api_calls[before:] if call['method'] == 'POST']
                assert len(calls) == 1 and calls[0]['key'] == kind, 'Invalid supplied key must not fall back to a saved/shared key'
                assert storage(page) == {'session': VALID, 'local': None}, 'Testing a draft must not replace the saved key'
            field.fill(VALID)
            close_settings(page)
            mark('connection test uses draft headers, reports invalid or quota errors, and never replaces or falls back to saved keys')

            image = page.evaluate("""() => {
              const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
              const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 640, 400);
              ctx.fillStyle = '#234'; ctx.font = '32px sans-serif'; ctx.fillText('Synthetic BYOK contact', 40, 120);
              return canvas.toDataURL('image/jpeg').split(',')[1];
            }""")
            page.get_by_role('button', name='掃描新名片', exact=True).click()
            page.get_by_label('從相簿選擇名片照片', exact=True).set_input_files({'name': 'synthetic-byok.jpg', 'mimeType': 'image/jpeg', 'buffer': base64.b64decode(image)})
            page.get_by_role('button', name='完成（1）', exact=True).click()
            expect(page.get_by_role('heading', name='個人金鑰測試名片', exact=True)).to_be_visible()
            assert [call for call in api_calls if call['path'].endswith('/scan')] == [{'path': '/api/gemini/scan', 'method': 'POST', 'key': 'valid-synthetic'}]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                snapshot = page.evaluate(READ_SNAPSHOT)
                if snapshot and any(card.get('name') == '個人金鑰測試名片' for card in snapshot['cards']):
                    break
                page.wait_for_timeout(50)
            serialized = json.dumps(snapshot, ensure_ascii=False)
            assert not any(secret in serialized for secret in SECRETS)
            page.get_by_role('button', name='資料管理與設定', exact=True).click()
            with page.expect_download() as download_info:
                page.get_by_role('button', name='建立完整備份 (含圖片)', exact=True).click()
            download_path = OUTPUT / 'synthetic-byok-backup.json'
            download_info.value.save_as(download_path)
            assert not any(secret in download_path.read_text() for secret in SECRETS)
            mark('photo scan succeeds without a shared server key using only the personal header; IndexedDB and JSON backup exclude credentials')

            scan_control['hold'] = True
            page.get_by_role('button', name='掃描新名片', exact=True).click()
            page.get_by_label('從相簿選擇名片照片', exact=True).set_input_files({'name': 'synthetic-pending.jpg', 'mimeType': 'image/jpeg', 'buffer': base64.b64decode(image)})
            page.get_by_role('button', name='完成（1）', exact=True).click()
            deadline = time.monotonic() + 10
            pending = None
            while time.monotonic() < deadline:
                snapshot = page.evaluate(READ_SNAPSHOT)
                pending = next((card for card in snapshot['cards'] if card.get('isProcessing')), None)
                if pending and scan_control['held']:
                    break
                page.wait_for_timeout(50)
            assert pending and scan_control['held'], 'Second photo must be saved while its scan is pending'
            pending_id, pending_photo = pending['id'], pending['imageBase64']
            field = open_settings(page)
            field.fill(REPLACEMENT)
            page.get_by_role('button', name='儲存金鑰', exact=True).click()
            wait_saved(page, {'session': REPLACEMENT, 'local': None})
            close_settings(page)
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                snapshot = page.evaluate(READ_SNAPSHOT)
                interrupted = next(card for card in snapshot['cards'] if card['id'] == pending_id)
                if interrupted.get('isError') and not interrupted.get('isProcessing'):
                    break
                page.wait_for_timeout(50)
            assert interrupted.get('isError') and '設定已變更' in interrupted.get('errorMessage', '')
            assert interrupted['imageBase64'] == pending_photo
            assert page.evaluate('window.__abortedScans') == 1, 'Changing keys must abort the active network request'
            for held in scan_control['held']:
                try:
                    held.fulfill(json={'structuredData': {
                        'name': '不得出現的舊結果', 'company': '', 'title': '', 'phone': '',
                        'email': '', 'address': '', 'notes': '', 'rawText': 'stale result',
                    }})
                except Exception:
                    # The fetch has already been aborted; a cancelled route may reject fulfillment.
                    pass
            scan_control['held'].clear()
            page.wait_for_timeout(100)
            assert not any(card['name'] == '不得出現的舊結果' for card in page.evaluate(READ_SNAPSHOT)['cards'])
            page.get_by_role('button', name='重新辨識名片', exact=True).click()
            expect(page.get_by_role('heading', name='更換金鑰後的名片', exact=True)).to_be_visible()
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                snapshot = page.evaluate(READ_SNAPSHOT)
                retried = next(card for card in snapshot['cards'] if card['id'] == pending_id)
                if retried['name'] == '更換金鑰後的名片' and not retried.get('isProcessing'):
                    break
                page.wait_for_timeout(50)
            assert retried['name'] == '更換金鑰後的名片' and retried['imageBase64'] == pending_photo
            assert len(snapshot['cards']) == 2
            assert [call['key'] for call in api_calls if call['path'].endswith('/scan')] == ['valid-synthetic', 'valid-synthetic', 'replacement-synthetic']
            assert not any(secret in json.dumps(snapshot) for secret in SECRETS)
            mark('changing the key aborts an active scan, preserves its photo, rejects stale results, and retry uses the new header')

            page.close()
            page = new_page()
            field = open_settings(page)
            expect(field).to_have_value('')
            assert storage(page) == {'session': None, 'local': None}
            field.fill(VALID)
            page.get_by_label('在此裝置記住金鑰', exact=True).check()
            page.get_by_role('button', name='儲存金鑰', exact=True).click()
            wait_saved(page, {'session': None, 'local': VALID})
            page.close()
            page = new_page()
            field = open_settings(page)
            expect(field).to_have_value(VALID)
            expect(page.get_by_label('在此裝置記住金鑰', exact=True)).to_be_checked()
            mark('new tab starts without the old session key; opt-in remembered key alone survives closing and reopening the tab')

            page.get_by_role('button', name='移除金鑰', exact=True).click()
            wait_saved(page, {'session': None, 'local': None})
            expect(field).to_have_value('')
            close_settings(page)
            page.reload(wait_until='domcontentloaded')
            field = open_settings(page)
            expect(field).to_have_value('')
            mark('removing a key clears both storage scopes and remains cleared after reload')

            page.evaluate("""name => {
              const original = Storage.prototype.setItem;
              Storage.prototype.setItem = function(key, value) {
                if (key === name) throw new DOMException('Synthetic storage denial', 'QuotaExceededError');
                return original.call(this, key, value);
              };
            }""", KEY_NAME)
            field.fill(VALID)
            page.get_by_role('button', name='儲存金鑰', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('儲存')
            assert storage(page) == {'session': None, 'local': None}
            mark('blocked browser storage reports failure instead of claiming the key was saved')

            field.fill('')
            page.screenshot(path=str(OUTPUT / 'mobile-api-key-storage-error.png'))
            assert not page_errors, page_errors
            assert all(call['key'] == 'absent' for call in api_calls if call['method'] == 'GET')
            mark('no uncaught browser errors, URL/body credential leakage, or credentials on readiness GETs')
        except Exception as error:
            failure = str(error)
            # Password inputs remain masked; only synthetic credentials are used.
            page.screenshot(path=str(OUTPUT / 'mobile-api-key-failure.png'))
            raise
        finally:
            report = {'base_url': BASE_URL, 'passed': passed, 'failure': failure, 'page_errors': page_errors, 'api_calls': api_calls, 'blocked_external_hosts': sorted(external_hosts)}
            (OUTPUT / 'browser-api-key-smoke.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(json.dumps(report, ensure_ascii=False), flush=True)
            context.close()
            browser.close()


if __name__ == '__main__':
    main()
