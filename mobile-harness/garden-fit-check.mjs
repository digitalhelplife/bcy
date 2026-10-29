import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
const vps = [{w:393,h:852},{w:375,h:667},{w:393,h:742},{w:393,h:702}]
let failures = 0
const check = (n, ok, d='') => { if(!ok) failures++; console.log(`${ok?'PASS':'FAIL'} ${n} ${d}`) }
for (const vp of vps) {
  const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
  if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
  await page.locator('[data-testid="enter"]').waitFor({ timeout: 60000 }); await page.getByTestId('enter').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
  await page.getByTestId('nav-garden').click()
  await page.locator('.phaser-host canvas').last().waitFor({ timeout: 30000 })
  await sleep(1800)
  const measure = () => page.evaluate(() => {
    const r = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),bottom:+b.bottom.toFixed(1)} }
    const c=[...document.querySelectorAll('.phaser-host canvas')].pop(); const b=c.getBoundingClientRect()
    const map = (wx,wy) => ({x:b.x+wx*b.width/1080, y:b.y+wy*b.height/1920})
    return {stage:r('.stage'), hud:r('.garden-hud'), canvas:{x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),bottom:+b.bottom.toFixed(1)}, plots:[124,290,456,622,788,954].map(x=>map(x,1506)), plots78:[373,705].map(x=>map(x,1662))}
  })
  const g = await measure()
  console.log(`\n== ${vp.w}x${vp.h} VIEW`, JSON.stringify(g))
  const inside = p => p.x>=0 && p.x<=vp.w && p.y>=g.stage.y && p.y<=g.stage.bottom
  check(`${vp.w}x${vp.h} view canvas covers width`, g.canvas.w >= g.stage.w-0.5, `${g.canvas.w}/${g.stage.w}`)
  check(`${vp.w}x${vp.h} view canvas covers height`, g.canvas.h >= g.stage.h-0.5, `${g.canvas.h}/${g.stage.h}`)
  check(`${vp.w}x${vp.h} view plot row inside`, g.plots.every(inside), JSON.stringify(g.plots.map(p=>[Math.round(p.x),Math.round(p.y)]).slice(0,2)))
  check(`${vp.w}x${vp.h} view plot7/8 inside`, g.plots78.every(inside), JSON.stringify(g.plots78.map(p=>[Math.round(p.x),Math.round(p.y)])))
  // tap plot 1
  const c = page.locator('.phaser-host canvas').last(); const box = await c.boundingBox()
  await page.mouse.click(box.x + 124*box.width/1080, box.y + 1506*box.height/1920)
  await sleep(700)
  check(`${vp.w}x${vp.h} view plot tap`, (await page.locator('body').innerText()).includes('种植槽 1'))
  await page.screenshot({ path: `/tmp/garden-view-${vp.w}x${vp.h}.png` })
  // close sheet if open, enter edit mode
  const close = page.locator('.sheet .icon-btn, [aria-label="关闭"]').first()
  if (await close.count()) await close.click().catch(()=>{})
  await page.getByTestId('edit-garden').click()
  await page.waitForTimeout(1200)
  const e = await measure()
  console.log(`== ${vp.w}x${vp.h} EDIT`, JSON.stringify(e))
  check(`${vp.w}x${vp.h} edit canvas covers width`, e.canvas.w >= e.stage.w-0.5, `${e.canvas.w}/${e.stage.w}`)
  check(`${vp.w}x${vp.h} edit canvas covers height`, e.canvas.h >= e.stage.h-0.5, `${e.canvas.h}/${e.stage.h}`)
  await page.screenshot({ path: `/tmp/garden-edit-${vp.w}x${vp.h}.png` })
  await page.close()
}
console.log('\nSUMMARY', failures===0?'ALL_PASS':`${failures} FAILURES`)
await browser.close()
process.exit(failures===0?0:1)
