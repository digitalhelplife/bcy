import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
const sleep = ms => new Promise(r=>setTimeout(r,ms))
let failures=0
const check=(n,ok,d='')=>{if(!ok)failures++;console.log(`${ok?'PASS':'FAIL'} ${n} ${d}`)}
const layerT=()=>page.evaluate(()=>document.querySelector('.map-zoom-layer')?.style.transform||'')
const scaleOf=t=>parseFloat((t.match(/scale\(([^)]+)\)/)||[0,'1'])[1])
async function pinch(selector, from, to){
  await page.evaluate(async ({selector,from,to})=>{
    const vp=document.querySelector(selector); const r=vp.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2
    const ev=(t,id,x,y,b)=>new PointerEvent(t,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',isPrimary:id===1,clientX:x,clientY:y,button:0,buttons:b})
    vp.dispatchEvent(ev('pointerdown',1,cx-from,cy,1)); vp.dispatchEvent(ev('pointerdown',2,cx+from,cy,1)); await new Promise(r=>setTimeout(r,40))
    vp.dispatchEvent(ev('pointermove',1,cx-to,cy,1)); vp.dispatchEvent(ev('pointermove',2,cx+to,cy,1)); await new Promise(r=>setTimeout(r,40))
    vp.dispatchEvent(ev('pointerup',1,cx-to,cy,0)); vp.dispatchEvent(ev('pointerup',2,cx+to,cy,0))
  },{selector,from,to}); await sleep(250)
}
await page.goto(base,{waitUntil:'domcontentloaded'})
if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
await page.locator('[data-testid="enter"]').waitFor({timeout:60000}); await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({timeout:30000}); await sleep(800)
check('no map control bar', await page.locator('.map-zoom-controls').count()===0)
await pinch('.map-viewport',40,60)
const z=await layerT(); check('map pinch zooms by default', scaleOf(z)>1, z)
const box=await page.locator('.map-viewport').boundingBox()
await page.mouse.move(box.x+box.width/2, box.y+box.height/2); await page.mouse.down(); await page.mouse.move(box.x+box.width/2-55, box.y+box.height/2-35,{steps:8}); await page.mouse.up()
const d=await layerT(); check('map one-finger drag pans', d!==z, d)
await pinch('.map-viewport',60,15)
const r=await layerT(); check('map pinch out resets', scaleOf(r)===1 && /translate3d\(0px, 0px, 0px\)/.test(r), r)
await page.getByRole('button',{name:'都江堰水利工程'}).click(); await sleep(500)
check('map node tap still works', (await page.locator('body').innerText()).includes('渠首寻踪'))
const close=page.locator('.sheet .icon-btn, [aria-label="关闭"]').first(); if (await close.count()) await close.click().catch(()=>{})
await sleep(300)
await pinch('.map-viewport',40,60)
const nb=await page.getByRole('button',{name:'都江堰水利工程'}).boundingBox()
if (nb) { await page.mouse.move(nb.x+nb.width/2,nb.y+nb.height/2); await page.mouse.down(); await page.mouse.move(nb.x+nb.width/2-60,nb.y+nb.height/2+40,{steps:8}); await page.mouse.up(); await sleep(400) }
check('map node drag suppresses click', !(await page.locator('body').innerText()).includes('渠首寻踪'))
await page.screenshot({path:'/tmp/mapzoom-default.png'})
console.log('\nSUMMARY', failures===0?'ALL_PASS':`${failures} FAILURES`)
await browser.close(); process.exit(failures===0?0:1)
