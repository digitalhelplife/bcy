import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
await page.locator('[data-testid="enter"]').waitFor({ timeout: 60000 }); await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
await page.getByTestId('nav-garden').click()
await page.locator('.phaser-host canvas').last().waitFor({ timeout: 30000 })
await page.waitForTimeout(1500)
const g = await page.evaluate(() => {
  const r = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)} }
  const c=[...document.querySelectorAll('.phaser-host canvas')].pop(); const b=c.getBoundingClientRect()
  return {stage:r('.stage'),host:r('.phaser-host'),canvas:{x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)},style:c.getAttribute('style'),mode:window.__phaser?.scale?.scaleMode}
})
console.log('GARDEN', JSON.stringify(g))
const canvas = page.locator('.phaser-host canvas').last()
const box = await canvas.boundingBox()
// plot_1 world (124,1506)
const x = box.x + 124 * box.width / 1080, y = box.y + 1506 * box.height / 1920
await page.mouse.click(x, y)
await page.waitForTimeout(800)
const txt = await page.locator('body').innerText()
console.log('PLOT_SHEET', txt.includes('种植槽 1'), 'CANVAS_CENTERED_X', Math.abs(g.canvas.x + g.canvas.w/2 - (g.stage.x + g.stage.w/2)) < 1.5)
await page.screenshot({ path: '/tmp/fit2-garden.png' })
await browser.close()
