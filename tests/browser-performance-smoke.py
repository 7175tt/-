"""Bounded rendering/memory with 264 independently stored 3200px synthetic photos."""
import asyncio, json, os, runpy
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright, expect

BASE=os.environ.get('BASE_URL','http://127.0.0.1:3114').rstrip('/')
OUTPUT=Path(os.environ.get('TEST_RESULTS_DIR','test-results/performance/scale'))
MOCK=runpy.run_path(str(Path(__file__).with_name('browser-sync-smoke.py')))['MOCK']
INIT=r'''(() => {
 window.perfReads=0;window.perfPhotoWrites=0;window.perfDecoding=0;window.perfPeak=0;
 const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
 IDBObjectStore.prototype.get=function(...args){if(this.name==='photos'&&!String(args[0]).startsWith('thumbnail:'))window.perfReads++;return get.apply(this,args)};
 IDBObjectStore.prototype.put=function(...args){if(this.name==='photos'&&!String(args[1]).startsWith('thumbnail:'))window.perfPhotoWrites++;return put.apply(this,args)};
 const decode=HTMLImageElement.prototype.decode;
 HTMLImageElement.prototype.decode=async function(){window.perfDecoding++;window.perfPeak=Math.max(window.perfPeak,window.perfDecoding);try{return await decode.call(this)}finally{window.perfDecoding--}};
 window.perfCards=Array.from({length:264},(_,i)=>({id:`perf-${i}`,name:`合成聯絡人 ${String(i+1).padStart(3,'0')}`,
   company:'效能測試公司',title:'工程師',phone:'02-12345678',email:'test@example.invalid',address:'測試地址',notes:'',rawText:'',timestamp:100,
   imageLocalId:`perf-photo-${i}`,imageDriveId:`perf-drive-${i}`,cloudAccount:'a@example.invalid',lastSyncedAt:100,lastSyncedSheetId:'a-sheet'}));
 window.__cloud.rows.a.push(...window.perfCards.map(c=>window.__cloud.rows.a[0].map(h=>c[h]??'')));
 sessionStorage.setItem('KEEPER_GOOGLE_AUTH',JSON.stringify({tokenResponse:{access_token:'test-token-a'},user:{email:'a@example.invalid',name:'效能測試',picture:''},expiresAt:Date.now()+3600000}));
})()'''

async def main():
 OUTPUT.mkdir(parents=True,exist_ok=True)
 checks=[];errors=[]
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True)
  context=await browser.new_context(viewport={'width':1372,'height':928})
  await context.add_init_script(MOCK+'\n'+INIT)
  async def intercept(route):
   parsed=urlsplit(route.request.url)
   if parsed.netloc!=urlsplit(BASE).netloc:await route.abort()
   elif parsed.path=='/__performance-seed':await route.fulfill(content_type='text/html',body='<html><body>seed</body></html>')
   elif parsed.path=='/api/gemini/status':await route.fulfill(json={'configured':True})
   else:await route.continue_()
  await context.route('**/*',intercept)
  page=await context.new_page();page.set_default_timeout(25000);page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto(BASE+'/__performance-seed')
  photo_bytes=await page.evaluate(r'''async()=>{
   const canvas=document.createElement('canvas');canvas.width=3200;canvas.height=2000;
   const ctx=canvas.getContext('2d');const image=ctx.createImageData(3200,2000);
   let seed=123456;
   for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255;}
   ctx.putImageData(image,0,0);const photo=canvas.toDataURL('image/jpeg',0.45).split(',')[1];
   await new Promise((resolve,reject)=>{const open=indexedDB.open('business-card-keeper',2);
    open.onupgradeneeded=()=>{open.result.createObjectStore('snapshots');open.result.createObjectStore('photos');};
    open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction(['snapshots','photos'],'readwrite');
     tx.objectStore('snapshots').put({version:2,cards:window.perfCards,deletions:[]},'current');
     for(let i=0;i<264;i++)tx.objectStore('photos').put(photo,`perf-photo-${i}`);
     tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error);};});
   return Math.floor(photo.length*3/4);
  }''')
  await page.goto(BASE,wait_until='domcontentloaded')
  await expect(page.locator('article')).to_have_count(24)
  await page.wait_for_function("document.querySelector('article img')?.naturalWidth===256")
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  await page.wait_for_function('window.perfDecoding===0')
  initial=await page.evaluate('({reads:perfReads,peak:perfPeak,writes:perfPhotoWrites,images:document.querySelectorAll("article img").length})')
  assert initial['reads']<=24 and initial['peak']<=2 and initial['writes']==0,initial
  checks.append('264 full-size photos remain on disk; first page renders only 24 cards and decodes at most two originals concurrently')
  cdp=await context.new_cdp_session(page)
  async def heap():
   await cdp.send('HeapProfiler.collectGarbage');await cdp.send('Performance.enable')
   metrics=await cdp.send('Performance.getMetrics');return next(x['value'] for x in metrics['metrics'] if x['name']=='JSHeapUsedSize')
  initial_heap=await heap()
  for i in range(1,11):
   await page.get_by_role('button',name='下一頁名片',exact=True).click()
   await expect(page.get_by_role('heading',name=f'合成聯絡人 {i*24+1:03d}',exact=True)).to_be_visible()
   await page.wait_for_function("document.querySelector('article img')?.naturalWidth===256")
   await expect(page.locator('article')).to_have_count(24)
  final_heap=await heap()
  assert final_heap-initial_heap<30*1024*1024,(initial_heap,final_heap)
  checks.append('paging through all 264 contacts keeps the DOM bounded and releases previous-page image memory')
  await page.reload(wait_until='domcontentloaded')
  await expect(page.get_by_role('status',name='本機已儲存 · 已與 Google 同步',exact=True)).to_be_visible()
  await page.wait_for_function("document.querySelector('article img')?.naturalWidth===256")
  assert await page.evaluate('window.perfReads')==0
  checks.append('revisiting a page reads saved small thumbnails without loading its full-size originals again')
  await page.get_by_role('searchbox',name='搜尋名片',exact=True).fill('合成聯絡人 264')
  await expect(page.locator('article')).to_have_count(1)
  await expect(page.get_by_role('heading',name='合成聯絡人 264',exact=True)).to_be_visible()
  checks.append('search still covers the full collection and finds contacts outside the current page')
  await page.get_by_role('button',name='查看名片照片',exact=True).click()
  preview=page.get_by_role('dialog',name='名片照片預覽').locator('img')
  await expect(preview).to_be_visible();await preview.evaluate('i=>i.decode()')
  assert await preview.evaluate('i=>i.naturalWidth')==3200
  await page.keyboard.press('Escape')
  checks.append('thumbnails are 256px while zoom preserves the original 3200px image')
  assert not errors,errors
  report={'passed':checks,'original_bytes_each':photo_bytes,'photo_count':264,'initial':initial,'initial_heap_bytes':initial_heap,'heap_after_all_pages_bytes':final_heap,'page_errors':errors}
  (OUTPUT/'browser-performance-smoke.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
  await browser.close()
asyncio.run(main())
