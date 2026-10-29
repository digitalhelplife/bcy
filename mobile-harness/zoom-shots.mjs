import { chromium } from 'playwright'
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--no-sandbox'] })
const page = await browser.newPage({ viewport:{width:393,height:852}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
await page.goto('http://127.0.0.1:3000/', { waitUntil:'domcontentloaded' })
if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
await page.locator('[data-testid="enter"]').waitFor({timeout:60000}); await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({timeout:30000}); await page.waitForTimeout(800)
await page.screenshot({ path:'/tmp/zoom-map-rest.png' })
await page.getByRole('button',{name:'寻踪', exact:true}).first().click(); await page.getByTestId('start-run').click()
await page.locator('.phaser-host canvas').last().waitFor({timeout:60000}); await page.waitForTimeout(1500)
await page.screenshot({ path:'/tmp/zoom-find-rest.png' })
await page.getByRole('button',{name:'移动/缩放模式'}).click(); await page.waitForTimeout(300)
await page.screenshot({ path:'/tmp/zoom-find-mode.png' })
await browser.close()
