import { chromium } from 'playwright'

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
await page.goto('https://bencaoyou.tryliang.me/', { waitUntil: 'domcontentloaded', timeout: 120000 })
if (await page.getByTestId('consent-agree').count()) {
  await page.getByTestId('consent-agree').check()
  await page.getByTestId('consent-accept').click()
}
await page.locator('[data-testid="enter"]').waitFor({ timeout: 90000 })
await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
await page.getByRole('button', { name: '寻踪', exact: true }).first().click()
await page.getByTestId('start-run').click()
await page.locator('.phaser-host canvas').waitFor({ timeout: 60000 })
await page.waitForTimeout(1500)
const findGeom = await page.evaluate(() => {
  const rect = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
  const c = document.querySelector('.phaser-host canvas')
  const cr = c.getBoundingClientRect()
  const g = window.__phaser
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    app: rect('.app'), shell: rect('.shell'), screen: rect('.explore-screen'),
    top: rect('.explore-top'), strip: rect('.target-strip'), stage: rect('.stage'),
    host: rect('.phaser-host'), canvas: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
    scale: g ? { mode: g.scale.scaleMode, dw: g.scale.displaySize.width, dh: g.scale.displaySize.height, pw: g.scale.parentSize.width, ph: g.scale.parentSize.height } : null,
    world: { w: 1080, h: 1920 }, aspectCanvas: cr.width / cr.height, aspectWorld: 1080 / 1920,
  }
})
console.log('FIND', JSON.stringify(findGeom, null, 1))
await page.screenshot({ path: '/tmp/fit-find.png' })

// finish find quickly via synthetic taps so we can reach the puzzle
async function syn(wx, wy) {
  await page.evaluate(async ({ wx, wy }) => {
    const c = document.querySelector('.phaser-host canvas'); const r = c.getBoundingClientRect()
    const p = { x: r.x + wx * r.width / 1080, y: r.y + wy * r.height / 1920 }
    const fire = (t, b) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: b })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: b, view: window })) }
    fire('pointerdown', 1); fire('mousedown', 1); await new Promise(r => setTimeout(r, 90)); fire('pointerup', 0); fire('mouseup', 0)
  }, { wx, wy })
}
async function drag(x1, y1, x2, y2) {
  await page.evaluate(async ({ x1, y1, x2, y2 }) => {
    const c = document.querySelector('.phaser-host canvas'); const r = c.getBoundingClientRect()
    const pt = (x, y) => ({ x: r.x + x * r.width / 1080, y: r.y + y * r.height / 1920 })
    const a = pt(x1, y1), b = pt(x2, y2)
    const fire = (t, p, bs) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: bs })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: bs, view: window })) }
    fire('pointerdown', a, 1); fire('mousedown', a, 1); await new Promise(r => setTimeout(r, 100))
    for (let i = 1; i <= 16; i++) { const q = { x: a.x + (b.x - a.x) * i / 16, y: a.y + (b.y - a.y) * i / 16 }; fire('pointermove', q, 1); fire('mousemove', q, 1); await new Promise(r => setTimeout(r, 35)) }
    fire('pointerup', b, 0); fire('mouseup', b, 0)
  }, { x1, y1, x2, y2 })
}
await drag(610, 770, 860, 900)
await page.waitForTimeout(900)
await syn(362, 356); await page.waitForTimeout(800)
await syn(500, 812); await page.waitForTimeout(800)
await syn(602, 772)
await page.getByText('完成', { exact: false }).first().waitFor({ timeout: 20000 })
await page.getByRole('button', { name: '继续游览' }).click().catch(async () => { await page.getByTestId('nav-map').click() })
await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
await page.getByRole('button', { name: '拼图', exact: false }).first().click()
await page.getByTestId('start-run').click()
await page.locator('.phaser-host canvas').waitFor({ timeout: 60000 })
await page.waitForTimeout(1500)
const puzzleGeom = await page.evaluate(() => {
  const rect = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
  const c = document.querySelector('.phaser-host canvas'); const cr = c.getBoundingClientRect()
  const g = window.__phaser
  return { viewport: { w: innerWidth, h: innerHeight }, app: rect('.app'), stage: rect('.stage'), host: rect('.phaser-host'), canvas: { x: cr.x, y: cr.y, w: cr.width, h: cr.height }, scale: g ? { mode: g.scale.scaleMode, dw: g.scale.displaySize.width, dh: g.scale.displaySize.height, pw: g.scale.parentSize.width, ph: g.scale.parentSize.height } : null }
})
console.log('PUZZLE', JSON.stringify(puzzleGeom, null, 1))
await page.screenshot({ path: '/tmp/fit-puzzle.png' })
await browser.close()
