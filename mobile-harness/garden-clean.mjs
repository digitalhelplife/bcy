import { chromium } from 'playwright'
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
for (const vp of [{w:393,h:852},{w:375,h:667}]) {
  const page = await browser.newPage({ viewport:{width:vp.w,height:vp.h}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
  await page.goto('http://127.0.0.1:3000/', { waitUntil:'domcontentloaded' })
  if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
  await page.locator('[data-testid="enter"]').waitFor({timeout:60000}); await page.getByTestId('enter').click()
  await page.getByText('都江堰水利工程').first().waitFor({timeout:30000})
  await page.getByTestId('nav-garden').click()
  await page.waitForTimeout(2500)
  await page.screenshot({ path:`/tmp/garden-clean-${vp.w}x${vp.h}.png` })
  await page.close()
}
await browser.close()
