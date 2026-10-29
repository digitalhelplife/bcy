import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (n, ok, d = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} ${d}`) }
const transform = () => page.evaluate(() => { const c = [...document.querySelectorAll('.phaser-host canvas')].pop(); return c ? c.style.transform : '' })
const scaleOf = t => parseFloat((t.match(/scale\(([^)]+)\)/) || [0, '1'])[1])

async function fireWorld(wx, wy) {
  await page.evaluate(async ({ wx, wy }) => {
    const c = [...document.querySelectorAll('.phaser-host canvas')].pop(); const r = c.getBoundingClientRect()
    const p = { x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920 }
    const f = (t, b) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: b })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: b, view: window })) }
    f('pointerdown', 1); f('mousedown', 1); await new Promise(r => setTimeout(r, 90)); f('pointerup', 0); f('mouseup', 0)
  }, { wx, wy })
}
async function dragWorld(x1, y1, x2, y2) {
  await page.evaluate(async ({ x1, y1, x2, y2 }) => {
    const c = [...document.querySelectorAll('.phaser-host canvas')].pop(); const r = c.getBoundingClientRect()
    const pt = (x, y) => ({ x: r.left + x * r.width / 1080, y: r.top + y * r.height / 1920 })
    const a = pt(x1, y1), b = pt(x2, y2)
    const f = (t, p, bs) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: bs })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: bs, view: window })) }
    f('pointerdown', a, 1); f('mousedown', a, 1); await new Promise(r => setTimeout(r, 100))
    for (let i = 1; i <= 16; i++) { const q = { x: a.x + (b.x - a.x) * i / 16, y: a.y + (b.y - a.y) * i / 16 }; f('pointermove', q, 1); f('mousemove', q, 1); await new Promise(r => setTimeout(r, 35)) }
    f('pointerup', b, 0); f('mouseup', b, 0)
  }, { x1, y1, x2, y2 })
}
async function touchDrag(selector, dx, dy) {
  await page.evaluate(async ({ selector, dx, dy }) => {
    const all = Array.from(document.querySelectorAll(selector)); const host = all[all.length - 1]
    const r = host.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const ev = (t, px, py, b) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, button: 0, buttons: b })
    host.dispatchEvent(ev('pointerdown', x, y, 1)); await new Promise(r => setTimeout(r, 40))
    for (let i = 1; i <= 8; i++) { host.dispatchEvent(ev('pointermove', x + dx * i / 8, y + dy * i / 8, 1)); await new Promise(r => setTimeout(r, 20)) }
    host.dispatchEvent(ev('pointerup', x + dx, y + dy, 0))
  }, { selector, dx, dy })
  await sleep(250)
}
async function pinch(selector, from, to) {
  await page.evaluate(async ({ selector, from, to }) => {
    const host = document.querySelector(selector); const r = host.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const ev = (t, id, x, y, b) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: b })
    host.dispatchEvent(ev('pointerdown', 1, cx - from, cy, 1))
    host.dispatchEvent(ev('pointerdown', 2, cx + from, cy, 1))
    await new Promise(r => setTimeout(r, 40))
    host.dispatchEvent(ev('pointermove', 1, cx - to, cy, 1))
    host.dispatchEvent(ev('pointermove', 2, cx + to, cy, 1))
    await new Promise(r => setTimeout(r, 40))
    host.dispatchEvent(ev('pointerup', 1, cx - to, cy, 0))
    host.dispatchEvent(ev('pointerup', 2, cx + to, cy, 0))
  }, { selector, from, to })
  await sleep(250)
}

await page.goto(base, { waitUntil: 'domcontentloaded' })
if (await page.getByTestId('consent-agree').count()) { await page.getByTestId('consent-agree').check(); await page.getByTestId('consent-accept').click() }
await page.locator('[data-testid="enter"]').waitFor({ timeout: 60000 }); await page.getByTestId('enter').click()
await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
// no controls anywhere
check('no scene control bar', await page.locator('.view-controls').count() === 0)
await page.getByRole('button', { name: '寻踪', exact: true }).first().click()
await page.getByTestId('start-run').click()
await page.locator('.phaser-host canvas').last().waitFor({ timeout: 60000 }); await sleep(1500)

const before = await transform()
// one-finger drag on empty art pans the image
await touchDrag('.phaser-host', 45, -30)
check('one-finger drag pans', (await transform()) !== before, await transform())

// two-finger pinch zooms by default
await pinch('.phaser-host', 40, 45)
const zt = await transform()
check('two-finger pinch zooms', scaleOf(zt) > 1, zt)
// tap a hotspot while zoomed
await fireWorld(362, 356); await sleep(800)
check('tap while zoomed', (await page.locator('body').innerText()).includes('1/3'))

// pinch out to minimum snaps back to the default view
await pinch('.phaser-host', 60, 15)
const rt = await transform()
check('pinch out resets view', scaleOf(rt) === 1 && /translate3d\(0px, 0px, 0px\)/.test(rt), rt)

// finish the level, then verify the garden gesture + plot tap
await dragWorld(610, 770, 860, 900); await sleep(700)
await fireWorld(500, 812); await sleep(700); await fireWorld(602, 772)
await page.getByText('完成', { exact: false }).first().waitFor({ timeout: 20000 })
await page.getByRole('button', { name: '去小院' }).click()
await page.locator('.phaser-host canvas').last().waitFor({ timeout: 30000 }); await sleep(1500)
check('no garden control bar', await page.locator('.view-controls').count() === 0)
await pinch('.phaser-host', 40, 60)
check('garden pinch zooms', scaleOf(await transform()) > 1, await transform())
await pinch('.phaser-host', 60, 15)
const cbox = await page.locator('.phaser-host canvas').last().boundingBox()
await page.mouse.click(cbox.x + 124 * cbox.width / 1080, cbox.y + 1506 * cbox.height / 1920)
await sleep(800)
check('garden plot after gesture', (await page.locator('body').innerText()).includes('种植槽 1'))
await page.screenshot({ path: '/tmp/defaultzoom-garden.png' })

console.log('\nSUMMARY', failures === 0 ? 'ALL_PASS' : `${failures} FAILURES`)
await browser.close(); process.exit(failures === 0 ? 0 : 1)
