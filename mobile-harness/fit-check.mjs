// Verifies the explore scenes now use cover scaling (art fills the stage) at phone viewports,
// and that targets / puzzle pieces remain inside the visible stage and respond to input.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`) }

async function fire(page, wx, wy) {
  await page.evaluate(async ({ wx, wy }) => {
    const cs = [...document.querySelectorAll('.phaser-host canvas')]; const c = cs[cs.length - 1]; const r = c.getBoundingClientRect()
    const p = { x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920 }
    const f = (t, b) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: b })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: b, view: window })) }
    f('pointerdown', 1); f('mousedown', 1); await new Promise(r => setTimeout(r, 90)); f('pointerup', 0); f('mouseup', 0)
  }, { wx, wy })
}
async function drag(page, x1, y1, x2, y2) {
  await page.evaluate(async ({ x1, y1, x2, y2 }) => {
    const cs = [...document.querySelectorAll('.phaser-host canvas')]; const c = cs[cs.length - 1]; const r = c.getBoundingClientRect()
    const pt = (x, y) => ({ x: r.left + x * r.width / 1080, y: r.top + y * r.height / 1920 })
    const a = pt(x1, y1), b = pt(x2, y2)
    const f = (t, p, bs) => { c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: bs })); c.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: p.x, clientY: p.y, button: 0, buttons: bs, view: window })) }
    f('pointerdown', a, 1); f('mousedown', a, 1); await new Promise(r => setTimeout(r, 100))
    for (let i = 1; i <= 16; i++) { const q = { x: a.x + (b.x - a.x) * i / 16, y: a.y + (b.y - a.y) * i / 16 }; f('pointermove', q, 1); f('mousemove', q, 1); await new Promise(r => setTimeout(r, 35)) }
    f('pointerup', b, 0); f('mouseup', b, 0)
  }, { x1, y1, x2, y2 })
}

async function geom(page) {
  return page.evaluate(() => {
    const rect = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom } }
    const cs = [...document.querySelectorAll('.phaser-host canvas')]; const c = cs[cs.length - 1]; const cr = c.getBoundingClientRect()
    const stage = rect('.stage'); const strip = rect('.target-strip')
    const mapPoint = (wx, wy) => ({ x: cr.x + wx * cr.width / 1080, y: cr.y + wy * cr.height / 1920 })
    return {
      vw: innerWidth, vh: innerHeight,
      stage, canvas: { x: cr.x, y: cr.y, w: cr.width, h: cr.height, bottom: cr.bottom },
      stripBottom: strip ? strip.bottom : null,
      coversW: cr.width >= (stage ? stage.w : 0) - 0.5,
      coversH: cr.height >= (stage ? stage.h : 0) - 0.5,
      yuzui: mapPoint(362, 356), feishayan: mapPoint(500, 812), baopingkou: mapPoint(602, 772),
      tray: [157.5, 412.5, 667.5, 922.5].map(x => mapPoint(x, 1600)),
      boardTop: mapPoint(315, 370), boardBottom: mapPoint(765, 970),
      mode: window.__phaser?.scale?.scaleMode,
    }
  })
}

for (const vp of [{ width: 393, height: 852 }, { width: 375, height: 667 }]) {
  console.log(`\n===== viewport ${vp.width}x${vp.height}`)
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 120000 })
  if (await page.getByTestId('consent-agree').count()) {
    await page.getByTestId('consent-agree').check()
    await page.getByTestId('consent-accept').click()
  }
  await page.locator('[data-testid="enter"]').waitFor({ timeout: 60000 })
  await page.getByTestId('enter').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: '寻踪', exact: true }).first().click()
  await page.getByTestId('start-run').click()
  await page.locator('.phaser-host canvas').last().waitFor({ timeout: 60000 })
  await sleep(1500)

  const f = await geom(page)
  console.log('FIND', JSON.stringify(f))
  check(`${vp.width} find canvas covers stage width`, f.coversW, `${f.canvas.w} vs ${f.stage.w}`)
  check(`${vp.width} find canvas covers stage height`, f.coversH, `${f.canvas.h} vs ${f.stage.h}`)
  check(`${vp.width} yuzui inside stage`, f.yuzui.y >= f.stage.y && f.yuzui.y <= f.stage.bottom, `y=${f.yuzui.y.toFixed(1)} stage=${f.stage.y.toFixed(1)}..${f.stage.bottom.toFixed(1)} stripBottom=${f.stripBottom}`)
  await page.screenshot({ path: `/tmp/fit2-find-${vp.width}.png` })

  // Complete the find with synthetic input through the new cover-scaled canvas.
  await drag(page, 610, 770, 860, 900)
  await sleep(800)
  await fire(page, 362, 356); await sleep(800)
  await fire(page, 500, 812); await sleep(800)
  await fire(page, 602, 772)
  await page.getByText('完成', { exact: false }).first().waitFor({ timeout: 20000 })
  check(`${vp.width} find playable`, true)

  await page.getByRole('button', { name: '去小院' }).click()
  await page.getByTestId('nav-map').click()
  await page.getByText('都江堰水利工程').first().waitFor({ timeout: 15000 })
  await page.getByRole('button', { name: '拼图', exact: false }).first().click()
  await page.getByTestId('start-run').click()
  await page.locator('.phaser-host canvas').last().waitFor({ timeout: 60000 })
  await sleep(1500)
  const p = await geom(page)
  console.log('PUZZLE', JSON.stringify(p))
  check(`${vp.width} puzzle canvas covers stage width`, p.coversW, `${p.canvas.w} vs ${p.stage.w}`)
  check(`${vp.width} puzzle canvas covers stage height`, p.coversH, `${p.canvas.h} vs ${p.stage.h}`)
  check(`${vp.width} puzzle all tray pieces inside stage`, p.tray.every(t => t.y >= p.stage.y && t.y <= p.stage.bottom && t.x >= 0 && t.x <= vp.width), JSON.stringify(p.tray.map(t => [Math.round(t.x), Math.round(t.y)])))
  check(`${vp.width} puzzle board inside stage`, p.boardTop.y >= p.stage.y && p.boardBottom.y <= p.stage.bottom, `top=${p.boardTop.y.toFixed(1)} bottom=${p.boardBottom.y.toFixed(1)} stage=${p.stage.y.toFixed(1)}..${p.stage.bottom.toFixed(1)}`)
  await page.screenshot({ path: `/tmp/fit2-puzzle-${vp.width}.png` })

  // Drag one piece to prove input still maps correctly under cover scaling.
  const seed = await page.evaluate(() => window.__bcy.snapshot.activeRun?.shuffleSeed)
  const order = await page.evaluate(seed => {
    let a = seed >>> 0
    const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const o = [0, 1, 2, 3]; for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1));[o[i], o[j]] = [o[j], o[i]] } return o
  }, seed)
  const targets = [[315, 370], [765, 370], [315, 970], [765, 970]]
  const tray = [[157.5, 1600], [412.5, 1600], [667.5, 1600], [922.5, 1600]]
  await drag(page, tray[0][0], tray[0][1], targets[order[0]][0], targets[order[0]][1])
  await sleep(800)
  const progress = await page.locator('body').innerText()
  check(`${vp.width} puzzle input works`, progress.includes('1/4') || progress.includes('完成'))
  await page.close()
}
console.log('\nSUMMARY', failures === 0 ? 'ALL_PASS' : `${failures} FAILURES`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
