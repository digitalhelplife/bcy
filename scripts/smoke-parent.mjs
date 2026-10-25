// F14 parent-mode smoke on a 390x844 phone viewport (local demo build).
// Usage: node scripts/smoke-parent.mjs [baseUrl]
// Checks: hint button always visible; a tap at 1.15 r from a target centre counts; hint ring + toast;
// result page shows the 讲给孩子听 card; the finish proof is the same shape as normal mode.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const out = process.env.SHOTS_DIR ?? 'shots'; mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'], executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
const toCss = (b, x, y) => ({ x: b.x + (x * b.width) / 1080, y: b.y + (y * b.height) / 1920 })
const box = () => page.locator('.phaser-host canvas').boundingBox()
const tapWorld = async (x, y) => { const p = toCss(await box(), x, y); await page.mouse.click(p.x, p.y) }
async function dragWorld(x1, y1, x2, y2) {
  const b = await box(); const a = toCss(b, x1, y1), c = toCss(b, x2, y2)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + ((c.x - a.x) * i) / 12, a.y + ((c.y - a.y) * i) / 12); await page.waitForTimeout(16) }
  await page.mouse.up()
}
const found = () => page.locator('.target-chip.found').count()
try {
  await page.addInitScript(() => localStorage.setItem('bcy.pref.parentMode', '1'))
  await page.goto(base, { timeout: 120000 })
  await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click()
  await page.getByTestId('enter').click({ timeout: 60000 })
  await page.locator('.map-node').first().locator('.chip').first().click()
  await page.getByTestId('route-plant').click(); await page.getByTestId('start-run').click()
  await page.waitForFunction(() => { const s = window.__phaser?.scene.getScene('find'); return !!s && s.sys.isActive() && s.children.list.length >= 1 }, null, { timeout: 60000 })
  await page.waitForTimeout(500)
  await page.evaluate(() => { const c = window.__bcy; const f = c.runFinish.bind(c); c.runFinish = (id, pf) => { window.__proof = pf; return f(id, pf) } })
  if (!(await page.getByTestId('find-hint').isVisible())) throw new Error('hint button must be always visible in parent mode')
  if (!(await page.getByText('亲子模式').first().isVisible())) throw new Error('parent mode badge missing')
  // 鱼嘴 (362,356) r=78: 1.15 r to the left counts only in parent mode
  await tapWorld(362 - 78 * 1.15, 356); await page.waitForTimeout(400)
  if ((await found()) !== 1) throw new Error('tap at 1.15 r should hit in parent mode')
  await page.getByTestId('find-hint').click()
  await page.getByText(/找找看|云雾/).first().waitFor({ timeout: 3000 })
  await page.waitForTimeout(300); await page.screenshot({ path: `${out}/p1-parent-hint.png` })
  // next unfound target (飞沙堰) lies under the fog image → the hint points at the fog first
  await page.waitForTimeout(2400)
  await page.getByTestId('find-hint').click()
  await page.getByText('先按住云雾').first().waitFor({ timeout: 3000 })
  await dragWorld(610, 770, 640, 1500); await page.waitForTimeout(300)
  await tapWorld(500, 812); await page.waitForTimeout(300)
  if ((await found()) !== 2) throw new Error('飞沙堰 should be found after moving the fog')
  await tapWorld(602 + 62 * 1.2, 772); // 1.2 r away
  await page.getByText('渠首寻踪 完成！').waitFor({ timeout: 15000 })
  await page.getByTestId('parent-tips').waitFor({ timeout: 5000 })
  const rows = await page.locator('[data-testid=parent-tips] p').count()
  if (rows < 3) throw new Error(`expected 3 讲给孩子听 rows, got ${rows}`)
  await page.waitForTimeout(300); await page.screenshot({ path: `${out}/p2-parent-result.png` })
  const pf = await page.evaluate(() => window.__proof)
  if (!pf || Object.keys(pf).sort().join() !== 'foundTargetIds,gates,kind' || pf.foundTargetIds.length !== 3) throw new Error(`proof shape changed: ${JSON.stringify(pf)}`)
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(`PARENT SMOKE OK — proof keys ${Object.keys(pf).sort().join(',')}`)
} catch (e) {
  await page.screenshot({ path: `${out}/pz-failure.png` }).catch(() => {})
  console.error('PARENT SMOKE FAIL —', e.message); process.exitCode = 1
} finally { await browser.close() }
