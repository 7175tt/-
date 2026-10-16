"""Device sessions, token expiry and account isolation with simulated Google."""
import asyncio, json, os, runpy
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright, expect

BASE=os.environ.get('BASE_URL','http://127.0.0.1:3114').rstrip('/')
OUTPUT=Path(os.environ.get('TEST_RESULTS_DIR','test-results/performance/auth'))
SYNC=runpy.run_path(str(Path(__file__).with_name('browser-sync-smoke.py')))
MOCK=SYNC['MOCK'].replace('/^test-token-([ab])$/',r'/^test-token-([ab])(?:-\d+)?$/').replace('return { requestAccessToken: () => mock.authenticate(mock.nextAccount) };', 'return { requestAccessToken: options => { window.lastLoginOptions=options; window.tokenRequests=(window.tokenRequests||0)+1; mock.authenticate(mock.nextAccount); } };')+r'''
(() => {
 window.google.accounts.oauth2.initCodeClient=options=>({requestCode:()=>{if(window.holdGooglePopup)window.delayedGoogleCode=options.callback;else options.callback({code:'synthetic-code'})}});
 const original=window.gapi.client.sheets.spreadsheets.values.get;
 window.forceExpiredRead=false;
 window.gapi.client.sheets.spreadsheets.values.get=async args=>{
   if(window.forceExpiredRead){window.forceExpiredRead=false;throw {status:401,result:{error:{message:'Expired synthetic access token'}}};}
   return original(args);
 };
 const card={id:'local-one',name:'未綁定本機',company:'合成公司',title:'',phone:'',email:'',address:'',notes:'',rawText:'只用於整合測試',timestamp:100};
 window.__cloud.rows.a.push(window.__cloud.rows.a[0].map(h=>card[h]??''));
})();'''

async def main():
 OUTPUT.mkdir(parents=True,exist_ok=True)
 checks=[];errors=[];counts={'code':0,'session':0,'logout':0};state={'revoked':False,'wrong_account':False,'enabled':True};serial=0
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  context=await browser.new_context(viewport={'width':390,'height':844})
  await context.add_init_script(MOCK)
  async def intercept(route):
   nonlocal serial
   parsed=urlsplit(route.request.url)
   if parsed.hostname=='www.googleapis.com' and parsed.path=='/oauth2/v3/userinfo':
    account='b' if 'test-token-b-' in route.request.headers.get('authorization','') else 'a'
    await route.fulfill(json={'email':f'{account}@example.invalid','name':f'Google 帳號 {account.upper()}','picture':''})
   elif parsed.netloc!=urlsplit(BASE).netloc:await route.abort()
   elif parsed.path=='/api/google/status':await route.fulfill(json={'persistentConfigured':state['enabled'],'clientId':'synthetic-client'})
   elif parsed.path.startswith('/api/google/'):
    action=parsed.path.rsplit('/',1)[-1];counts[action]+=1
    assert route.request.method=='POST'
    assert route.request.headers['x-requested-with']=='XmlHttpRequest'
    cookie=route.request.headers.get('cookie','')
    if action=='logout':await route.fulfill(json={'signedOut':True},headers={'set-cookie':'keeper-test-device=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'})
    elif action=='session' and ('keeper-test-device=opaque' not in cookie or state['revoked']):await route.fulfill(status=401,json={'code':'SESSION_EXPIRED','error':'Synthetic consent revoked'})
    else:
     if action=='code':assert route.request.post_data_json=={'code':'synthetic-code'}
     serial+=1;account='b' if state['wrong_account'] and action=='session' else 'a'
     await route.fulfill(json={'access_token':f'test-token-{account}-{serial}','expires_in':3600,'deviceRemembered':True},headers={'set-cookie':'keeper-test-device=opaque; Path=/; HttpOnly; SameSite=Lax'})
   elif parsed.path=='/api/gemini/status':await route.fulfill(json={'configured':True})
   else:await route.continue_()
  await context.route('**/*',intercept)
  page=await context.new_page();page.set_default_timeout(20000);page.on('pageerror',lambda e:errors.append(str(e)))
  await page.clock.install()
  await page.goto(BASE,wait_until='domcontentloaded')
  await SYNC['tool_action'](page,'登入並自動同步')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  assert counts['code']==1
  stored=await page.evaluate('JSON.stringify(localStorage)')
  assert 'test-token-' not in stored and 'refresh_token' not in stored and 'a@example.invalid' in stored
  assert 'keeper-test-device' not in await page.evaluate('document.cookie')
  print('CHECK',len(checks)+1,flush=True);checks.append('first sign-in exchanges a code and remembers the device without persistent JS-readable bearer or refresh credentials')
  before=counts['session'];old_token=await page.evaluate('window.__cloud.token.access_token')
  await page.clock.fast_forward(59*60*1000)
  await page.wait_for_function('old=>window.__cloud.token?.access_token!==old',arg=old_token)
  assert counts['session']==before+1
  print('CHECK',len(checks)+1,flush=True);checks.append('access tokens renew before expiry without a popup or clearing the current account')
  before=counts['session'];await page.evaluate('window.forceExpiredRead=true')
  await SYNC['tool_action'](page,'立即同步')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  assert counts['session']==before+1
  print('CHECK',len(checks)+1,flush=True);checks.append('an unexpected Google API 401 renews the session once and retries sync successfully')
  await page.close()
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE,wait_until='domcontentloaded')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  assert counts['code']==1
  print('CHECK',len(checks)+1,flush=True);checks.append('a reopened tab restores the device session automatically without another Google sign-in')
  state['wrong_account']=True
  await page.evaluate('window.forceExpiredRead=true')
  await SYNC['tool_action'](page,'立即同步')
  await expect(page.get_by_text('Google 需要重新連線，本機名片與照片已保留。',exact=True)).to_be_visible()
  assert not await page.evaluate('window.__cloud.events.some(e=>e.account==="b")')
  assert 'test-token-a-' in await page.evaluate('window.__cloud.token.access_token')
  print('CHECK',len(checks)+1,flush=True);checks.append('a silently changed Google account cannot replace the current account or upload its contacts')
  state['wrong_account']=False
  await page.get_by_role('button',name='重新連線 Google',exact=True).click()
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  state['revoked']=True;await page.evaluate('window.forceExpiredRead=true')
  await SYNC['tool_action'](page,'立即同步')
  await expect(page.get_by_text('Google 需要重新連線，本機名片與照片已保留。',exact=True)).to_be_visible()
  before=counts['session'];await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
  await page.wait_for_timeout(300)
  assert counts['session']==before
  print('CHECK',len(checks)+1,flush=True);checks.append('revoked consent prompts for reconnection and stops automatic failed-renewal loops')
  await page.evaluate('window.holdGooglePopup=true')
  await page.get_by_role('button',name='重新連線 Google',exact=True).click()
  code_before=counts['code']
  await SYNC['tool_action'](page,'登出')
  await page.wait_for_function('!window.__cloud.token')
  await page.evaluate('window.delayedGoogleCode({code:"synthetic-code"})')
  await page.wait_for_timeout(200)
  assert counts['code']==code_before
  checks.append('a late Google popup callback cannot sign the user back in after explicit logout')
  await page.close();page=await context.new_page()
  await page.goto(BASE,wait_until='domcontentloaded')
  await expect(page.get_by_role('button',name='資料管理與設定',exact=True)).to_be_visible()
  await page.get_by_role('button',name='資料管理與設定',exact=True).click()
  await expect(page.get_by_role('button',name='登入並自動同步',exact=True)).to_be_visible()
  assert not await page.evaluate('localStorage.getItem("KEEPER_GOOGLE_DEVICE")')
  print('CHECK',len(checks)+1,flush=True);checks.append('explicit logout clears device memory and does not restore the account in a new tab')
  await context.close()
  state['enabled']=False
  context=await browser.new_context(viewport={'width':390,'height':844})
  await context.add_init_script(MOCK);await context.route('**/*',intercept)
  page=await context.new_page();await page.clock.install();page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE,wait_until='domcontentloaded')
  await SYNC['tool_action'](page,'登入並自動同步')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  requests_before=counts['session']
  await page.clock.fast_forward(61*60*1000)
  await expect(page.get_by_text('Google 需要重新連線，本機名片與照片已保留。',exact=True)).to_be_visible()
  assert counts['session']==requests_before
  checks.append('without backend secrets, expiry produces one reconnection prompt without opening automatic popups')
  await page.close();page=await context.new_page();await page.goto(BASE,wait_until='domcontentloaded')
  await expect(page.get_by_text('Google 需要重新連線，本機名片與照片已保留。',exact=True)).to_be_visible()
  assert not await page.evaluate('window.tokenRequests')
  await SYNC['tool_action'](page,'繼續 Google 登入')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  assert (await page.evaluate('window.lastLoginOptions'))['login_hint']=='a@example.invalid'
  checks.append('fallback mode remembers only the account and reconnects with its login hint on the next user click')
  assert not errors,errors
  report={'passed':checks,'requests':counts,'page_errors':errors,'provider':'simulated'}
  (OUTPUT/'browser-google-session-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
  await browser.close()
asyncio.run(main())
