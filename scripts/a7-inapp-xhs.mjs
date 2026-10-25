// Verify the in-app-browser branch (Xiaohongshu UA): after generating a journal image, the app must show
// the full-screen data-URL save view with the long-press hint instead of a download button.
import { chromium } from 'playwright'

const base = process.env.BASE_URL || 'https://bencaoyou.tryliang.me/'
const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => chromium.launch({ channel: 'chrome' }))
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 xhsdiscover/8.0',
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
const auth404 = r => r.status() === 404 && r.url().replace(/[?#].*$/, '').endsWith('/auth/config')
page.on('response', r => { if (r.status() >= 400 && !auth404(r)) errors.push(`HTTP ${r.status()} ${r.url()}`) })
try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByTestId('consent-accept').waitFor({ timeout: 30000 })
  await page.getByTestId('consent-agree').check()
  await page.getByTestId('consent-accept').click()
  await page.getByTestId('enter').waitFor({ timeout: 60000 })
  await page.getByTestId('enter').click()
  await page.locator('.map-node').first().locator('.chip').first().click()
  await page.getByTestId('route-plant').click()
  await page.getByTestId('start-run').click()
  await page.waitForFunction(() => { const s = window.__phaser?.scene.getScene('find'); return !!s && s.sys.isActive() && s.children.list.length >= 1 }, null, { timeout: 60000 })
  await page.waitForTimeout(400)
  const box = await page.locator('.phaser-host canvas').boundingBox()
  const toCss = (x, y) => ({ x: box.x + (x * box.width) / 1080, y: box.y + (y * box.height) / 1920 })
  const tap = async (x, y) => { const p = toCss(x, y); await page.touchscreen.tap(p.x, p.y) }
  const drag = async (x1, y1, x2, y2) => {
    const a = toCss(x1, y1), c = toCss(x2, y2)
    await page.mouse.move(a.x, a.y); await page.mouse.down()
    for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + ((c.x - a.x) * i) / 12, a.y + ((c.y - a.y) * i) / 12); await page.waitForTimeout(16) }
    await page.mouse.up()
  }
  await drag(610, 770, 640, 1500)
  await page.waitForTimeout(250)
  await tap(362, 356); await page.waitForTimeout(200)
  await tap(500, 812); await page.waitForTimeout(200)
  await tap(602, 772)
  await page.getByText('渠首寻踪 完成！').waitFor({ timeout: 20000 })
  await page.getByRole('button', { name: '继续游览' }).click()
  await page.getByTestId('nav-share').click()
  await page.getByRole('button', { name: '自然笔记' }).click()
  await page.getByTestId('make-share').click()
  await page.getByTestId('share-save-overlay').waitFor({ timeout: 60000 })
  const hint = await page.locator('[data-testid=share-save-overlay] .save-hint').textContent()
  if (!hint || !hint.includes('长按图片')) throw new Error(`unexpected save hint: ${hint}`)
  await page.screenshot({ path: '/tmp/a7-inapp-xhs.png', fullPage: true })
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('INAPP_XHS_SAVE_VIEW_OK', hint.trim())
  await page.evaluate(() => window.__bcy.accountDelete()).catch(() => undefined)
  await page.waitForTimeout(800)
} finally {
  await browser.close()
}
