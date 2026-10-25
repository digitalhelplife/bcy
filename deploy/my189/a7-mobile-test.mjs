// Mobile-browser test on mymac. No physical handset was detected by devicectl/USB, so this uses the
// installed Chrome with a current iPhone device descriptor. The separate iOS Simulator Safari check
// covers the real iOS/WebKit first paint.
import { chromium, devices } from 'playwright'

const base = process.env.BASE_URL || 'https://bencaoyou.tryliang.me/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const iphone = devices['iPhone 15 Pro'] || {
  viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
}
const context = await browser.newContext({ ...iphone, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
const page = await context.newPage()
const errors = []
const auth404 = r => r.status() === 404 && r.url().replace(/[?#].*$/, '').endsWith('/auth/config')
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`console: ${m.text()}`) })
page.on('response', r => { if (r.status() >= 400 && !auth404(r)) errors.push(`HTTP ${r.status()} ${r.url()}`) })
const shot = name => page.screenshot({ path: `/tmp/a7-mobile-${name}.png`, fullPage: true })

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByTestId('consent-accept').waitFor({ timeout: 30000 })
  await shot('01-consent')
  await page.getByTestId('consent-agree').check()
  await page.getByTestId('consent-accept').click()
  await page.getByTestId('enter').waitFor({ timeout: 60000 })
  await page.getByTestId('enter').click()
  await page.locator('.map-node').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(500)
  await shot('02-map')

  await page.locator('.map-node').first().locator('.chip').first().click()
  await page.getByTestId('route-plant').click()
  await page.getByTestId('start-run').click()
  await page.waitForFunction(() => { const s = window.__phaser?.scene.getScene('find'); return !!s && s.sys.isActive() && s.children.list.length >= 1 }, null, { timeout: 60000 })
  await page.waitForTimeout(500)
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
  await page.waitForTimeout(300)
  await tap(362, 356); await page.waitForTimeout(250)
  await tap(500, 812); await page.waitForTimeout(250)
  await tap(602, 772)
  await page.getByText('渠首寻踪 完成！').waitFor({ timeout: 20000 })
  await shot('03-result')

  await page.getByRole('button', { name: '继续游览' }).click()
  await page.getByTestId('nav-share').click()
  await page.getByRole('button', { name: '自然笔记' }).click()
  await page.getByTestId('make-share').click()
  await page.getByTestId('share-preview').waitFor({ timeout: 60000 })
  const size = await page.evaluate(() => { const img = document.querySelector('[data-testid=share-preview]'); return `${img.naturalWidth}x${img.naturalHeight}` })
  if (size !== '1080x1440') throw new Error(`bad nature export ${size}`)
  await page.waitForTimeout(400)
  await shot('04-nature')
  await page.getByTestId('nav-codex').click()
  await page.getByTestId('open-notebook').click()
  await page.getByTestId('notebook').waitFor({ timeout: 15000 })
  await shot('05-notebook')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log('MOBILE_CHROME_OK', size)
} finally {
  await browser.close()
}
