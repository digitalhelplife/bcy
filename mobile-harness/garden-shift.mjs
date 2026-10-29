import { chromium } from 'playwright'
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
await page.goto('http://127.0.0.1:3000/', { waitUntil:'domcontentloaded' })
if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
await page.locator('[data-testid="enter"]').waitFor({timeout:60000}); await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({timeout:30000})
await page.getByTestId('nav-garden').click(); await page.waitForTimeout(2000)
for (const dy of [0, 40, 70, 100]) {
  await page.evaluate(dy => { const h=document.querySelector('.phaser-host'); h.style.transform = dy ? `translateY(${dy}px)` : '' }, dy)
  await page.waitForTimeout(400)
  const geo = await page.evaluate(() => {
    const r=s=>{const e=document.querySelector(s);const b=e.getBoundingClientRect();return {y:+b.y.toFixed(1),bottom:+b.bottom.toFixed(1)}}
    const c=[...document.querySelectorAll('.phaser-host canvas')].pop(); const b=c.getBoundingClientRect()
    return { stage:r('.stage'), canvas:{y:+b.y.toFixed(1),bottom:+b.bottom.toFixed(1)}, plot: b.y+1506*b.height/1920, plot78: b.y+1662*b.height/1920 }
  })
  console.log('dy',dy,JSON.stringify(geo))
  await page.screenshot({ path:`/tmp/garden-shift-${dy}.png` })
}
await browser.close()
