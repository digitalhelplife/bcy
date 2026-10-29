// Validates that synthetic PointerEvents drive the live Phaser game (same code path
// the iPhone Safari autotest page will use). Real clicks are used for DOM; canvas
// interaction is synthetic.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'https://bencaoyou.tryliang.me/'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const text = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ')

async function synTap(wx, wy) {
  await page.evaluate(async ({ wx, wy }) => {
    const c = document.querySelector('.phaser-host canvas')
    if (!c) throw new Error('no canvas')
    const r = c.getBoundingClientRect()
    const p = { x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920 }
    const pe = (type, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons,
    }))
    const me = (type, buttons) => c.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y,
      button: 0, buttons, view: window,
    }))
    pe('pointerdown', 1); me('mousedown', 1)
    await new Promise(r => setTimeout(r, 90))
    pe('pointerup', 0); me('mouseup', 0)
  }, { wx, wy })
}

async function synDrag(x1, y1, x2, y2, steps = 16) {
  await page.evaluate(async ({ x1, y1, x2, y2, steps }) => {
    const c = document.querySelector('.phaser-host canvas')
    if (!c) throw new Error('no canvas')
    const r = c.getBoundingClientRect()
    const pt = (wx, wy) => ({ x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920 })
    const a = pt(x1, y1), b = pt(x2, y2)
    const pe = (type, p, buttons) => c.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons,
    }))
    const me = (type, p, buttons) => c.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y,
      button: 0, buttons, view: window,
    }))
    pe('pointerdown', a, 1); me('mousedown', a, 1)
    await new Promise(r => setTimeout(r, 100))
    for (let i = 1; i <= steps; i++) {
      const q = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }
      pe('pointermove', q, 1); me('mousemove', q, 1)
      await new Promise(r => setTimeout(r, 35))
    }
    await new Promise(r => setTimeout(r, 60))
    pe('pointerup', b, 0); me('mouseup', b, 0)
  }, { x1, y1, x2, y2, steps })
}

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`) }

try {
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 })
  if (await page.getByTestId('consent-agree').count()) {
    await page.getByTestId('consent-agree').check()
    await page.getByTestId('consent-accept').click()
  }
  await page.locator('[data-testid="enter"]').waitFor({ timeout: 90000 })
  await page.getByTestId('enter').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })

  await page.getByRole('button', { name: '寻踪', exact: true }).first().click()
  await page.getByTestId('route-plant').click()
  await page.getByTestId('start-run').click()
  await page.locator('.phaser-host canvas').waitFor({ timeout: 60000 })
  await sleep(1500)
  check('find-scene-ready', true)

  await synDrag(610, 770, 860, 900)
  await sleep(800)
  await synTap(362, 356); await sleep(900)
  check('find-1of3', (await text()).includes('1/3'))
  await synTap(500, 812); await sleep(900)
  check('find-2of3', (await text()).includes('2/3'))
  await synTap(602, 772)
  await page.getByText('完成', { exact: false }).first().waitFor({ timeout: 20000 })
  check('find-complete', true)

  await page.getByRole('button', { name: '去小院' }).click()
  await page.locator('.phaser-host canvas').waitFor({ timeout: 30000 })
  await sleep(1500)
  await synTap(124, 1506)
  await page.getByTestId('plant-seed_mint').waitFor({ timeout: 10000 })
  check('garden-plot-sheet', true)
  await page.getByTestId('plant-seed_mint').click()
  await page.getByTestId('claim-plant').waitFor({ timeout: 20000 })
  check('garden-instant-mature', true)
  await page.getByTestId('claim-plant').click()
  await page.getByTestId('edit-garden').waitFor({ timeout: 15000 })
  await page.getByTestId('edit-garden').click()
  await page.getByTestId('garden-auto').click()
  await page.getByRole('button', { name: '摆一摆' }).click()
  await sleep(700)
  await page.getByTestId('save-garden').click()
  await page.getByText('已保存', { exact: false }).first().waitFor({ timeout: 20000 })
  check('garden-saved', true, await page.evaluate(() => String(window.__bcy.snapshot.state?.garden?.placements?.length)))

  await page.getByTestId('nav-share').click()
  await page.getByTestId('make-share').click()
  await page.getByTestId('share-preview').waitFor({ timeout: 30000 })
  const dim = await page.getByTestId('share-preview').evaluate(img => `${img.naturalWidth}x${img.naturalHeight}`)
  check('journal-preview', dim === '1080x1440', dim)

  await page.getByTestId('nav-map').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '拼图', exact: false }).first().click()
  await page.getByTestId('start-run').click()
  await page.locator('.phaser-host canvas').waitFor({ timeout: 60000 })
  await sleep(1500)
  const seed = await page.evaluate(() => window.__bcy.snapshot.activeRun?.shuffleSeed)
  check('puzzle-seed', Number.isFinite(seed), String(seed))
  const order = await page.evaluate(seed => {
    let a = seed >>> 0
    const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const order = Array.from({ length: 4 }, (_, i) => i)
    for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    if (order.every((v, i) => v === i)) order.push(order.shift())
    return order
  }, seed)
  const targets = [[315, 370], [765, 370], [315, 970], [765, 970]]
  const tray = [[157.5, 1600], [412.5, 1600], [667.5, 1600], [922.5, 1600]]
  for (let i = 0; i < 4; i++) {
    const piece = order[i]
    await synDrag(tray[i][0], tray[i][1], targets[piece][0], targets[piece][1])
    await sleep(700)
    check(`puzzle-${i + 1}of4`, (await text()).includes(`${i + 1}/4`))
  }
  await page.getByText('完成', { exact: false }).first().waitFor({ timeout: 20000 })
  check('puzzle-complete', true)
  const final = await page.evaluate(() => ({
    levels: window.__bcy.snapshot.state.levels,
    inventory: window.__bcy.snapshot.state.inventory,
    placements: window.__bcy.snapshot.state.garden.placements.length,
    discovered: window.__bcy.snapshot.state.discoveredPlantIds,
  }))
  console.log('FINAL', JSON.stringify(final))
} catch (e) {
  check('exception', false, e.message)
} finally {
  console.log('ERRORS', JSON.stringify(errors.slice(0, 10)))
  console.log('SUMMARY', results.filter(r => !r.ok).length === 0 ? 'ALL_PASS' : 'HAS_FAILURES')
  await browser.close()
}
