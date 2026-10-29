import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
for (const vp of [{width:375,height:667},{width:393,height:852},{width:360,height:640}]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
  if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
  await page.locator('[data-testid="enter"]').waitFor({ timeout: 60000 }); await page.getByTestId('enter').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '寻踪', exact: true }).first().click(); await page.getByTestId('start-run').click()
  await page.locator('.phaser-host canvas').last().waitFor({ timeout: 60000 })
  let waited = 0
  for (const target of [500, 1500, 3000, 5000]) {
    await page.waitForTimeout(target - waited); waited = target
    const g = await page.evaluate(() => {
      const r = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {y:+b.y.toFixed(1),h:+b.height.toFixed(1),x:+b.x.toFixed(1),w:+b.width.toFixed(1)} }
      const c=[...document.querySelectorAll('.phaser-host canvas')].pop(); const b=c.getBoundingClientRect()
      return {stage:r('.stage'),host:r('.phaser-host'),canvas:{x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)},style:c.getAttribute('style'),scale:window.__phaser?.scale?{dw:window.__phaser.scale.displaySize.width,dh:window.__phaser.scale.displaySize.height,pw:window.__phaser.scale.parentSize.width,ph:window.__phaser.scale.parentSize.height}:null}
    })
    console.log(vp.width+'x'+vp.height, target+'ms', JSON.stringify(g))
  }
  await page.close()
}
await browser.close()
