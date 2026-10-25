// End-to-end smoke test on a 390x844 phone viewport against a running dev/preview server.
// Usage: node scripts/smoke.mjs [baseUrl]   (default http://127.0.0.1:3000/)
// Plays the tutorial loop for real through canvas input: fog drag + 3 hotspots, plant/instant
// grow/claim, garden edit + save, puzzle (incl. a wrong drop), share export, codex.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://127.0.0.1:3000/'
const out = process.env.SHOTS_DIR ?? 'shots'; mkdirSync(out, { recursive: true })
const args = ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
const executablePath = process.env.CHROMIUM_PATH
const browser = await chromium.launch({ args, executablePath }).catch(() => chromium.launch({ args, channel: 'chrome' }))
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => (errors.frozen ? [] : errors).push(`pageerror: ${e.message}`))
// The photo test's own fetch(blob:) probe is blocked by the production CSP by design — ignore only that.
const probeNoise = t => t.includes('blob:') && (t.includes('Content Security Policy') || t.includes('Fetch API cannot load blob:'))
// Device-trial deployments intentionally expose no /auth service; loadAuthConfig() maps its 404 to device mode.
const authConfig404 = r => r.status() === 404 && r.url().replace(/[?#].*$/, '').endsWith('/auth/config')
page.on('console', m => {
  if (m.type() !== 'error' || probeNoise(m.text())) return
  if (m.text().includes('Failed to load resource') && (m.location()?.url ?? '').replace(/[?#].*$/, '').endsWith('/auth/config')) return
  ;(errors.frozen ? [] : errors).push(`console: ${m.text()} @ ${m.location()?.url ?? ''}`)
})
page.on('response', r => { if (r.status() >= 400 && !authConfig404(r)) (errors.frozen ? [] : errors).push(`HTTP ${r.status()} ${r.url()}`) })
const shot = name => page.screenshot({ path: `${out}/${name}.png` })
const step = async (name, fn) => { process.stdout.write(`- ${name} … `); await fn(); console.log('ok') }

async function canvasBox() {
  await page.waitForFunction(() => !!document.querySelector('.phaser-host canvas'))
  return page.locator('.phaser-host canvas').boundingBox()
}
const toCss = (b, x, y) => ({ x: b.x + (x * b.width) / 1080, y: b.y + (y * b.height) / 1920 })
async function tapWorld(x, y) { const b = await canvasBox(); const p = toCss(b, x, y); await page.mouse.click(p.x, p.y) }
async function dragWorld(x1, y1, x2, y2) {
  const b = await canvasBox(); const a = toCss(b, x1, y1); const c = toCss(b, x2, y2)
  await page.mouse.move(a.x, a.y); await page.mouse.down()
  for (let i = 1; i <= 12; i++) { await page.mouse.move(a.x + ((c.x - a.x) * i) / 12, a.y + ((c.y - a.y) * i) / 12); await page.waitForTimeout(16) }
  await page.mouse.up()
}
let realname = false
function synthId(birth) {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2], C = '10X98765432'
  const b = '110101' + birth + String(Math.floor(Math.random() * 900) + 100); let t = 0
  for (let i = 0; i < 17; i++) t += Number(b[i]) * W[i]
  return b + C[t % 11]
}
// Wait for a write's success text. If the response was lost (server may have applied it), the app shows the
// "结果还没确认" banner: press 重试确认 like a user would — the server must replay its receipt, not apply twice.
let recoveries = 0
const confirmWrite = async (successRe, timeout = 20000) => {
  const ok = page.getByText(successRe).first(), banner = page.getByText(/结果还没确认/).first()
  for (let i = 0; i < 3; i++) {
    const r = await Promise.race([ok.waitFor({ timeout }).then(() => 'ok'), banner.waitFor({ timeout }).then(() => 'banner')])
    if (r === 'ok') return
    recoveries++; console.log(`  (lost response → 重试确认 #${recoveries})`)
    await page.getByRole('button', { name: '重试确认' }).first().click()
    // Settled = no pending write left (success), or the banner is back in the unknown state (lost again → loop).
    await page.waitForFunction(() => { const p = window.__bcy.snapshot.pending; return !p || p.status === 'unknown' }, null, { timeout })
    if (!(await page.evaluate(() => window.__bcy.snapshot.pending))) return
  }
  throw new Error('write still unconfirmed after 3 retries')
}
const waitScene = key => page.waitForFunction(k => { const s = window.__phaser?.scene.getScene(k); return !!s && s.sys.isActive() && s.children.list.length >= 1 }, key, { timeout: 60000 })

try {
  await step('boot', async () => {
    await page.goto(base, { timeout: 120000 })
    await page.getByTestId('consent-accept').waitFor({ timeout: 30000 })
    await shot('00-consent')
    if (!(await page.getByTestId('consent-accept').isDisabled())) throw new Error('consent button must start disabled')
    await page.getByTestId('consent-agree').check()
    await page.getByTestId('consent-accept').click()
    await page.locator('[data-testid="enter"], [data-testid="login-phone"], [data-testid="intro-continue"]').first().waitFor({ timeout: 90000 })
    if (await page.getByTestId('intro-continue').count()) await page.getByTestId('intro-continue').click()
    if (await page.getByTestId('login-phone').count()) {
      // realname mode (staging, mock SMS/realname): phone login → realname with a synthetic adult ID
      realname = true
      await shot('01a-login')
      await page.getByTestId('login-phone').fill('199' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'))
      await page.getByTestId('login-send').click()
      const dbg = await page.getByTestId('login-debug').textContent({ timeout: 15000 })
      await page.getByTestId('login-code').fill(dbg.match(/\d{6}/)[0])
      await page.getByTestId('login-submit').click()
      await page.getByTestId('rn-name').waitFor({ timeout: 20000 })
      await shot('01b-realname')
      await page.getByTestId('rn-name').fill('张测试')
      await page.getByTestId('rn-id').fill(synthId('19900101'))
      await page.getByTestId('rn-submit').click()
    }
    await page.getByTestId('enter').waitFor({ timeout: 30000 })
    await shot('01-boot')
    await page.getByTestId('enter').click()
    await page.locator('.map-node').first().waitFor()
    await page.waitForTimeout(600)
    await shot('02-map')
  })

  await step('dujiangyan find (fog + 3 hotspots)', async () => {
    await page.locator('.map-node').first().locator('.chip').first().click()
    await page.getByTestId('route-plant').click()
    await shot('03-route')
    await page.getByTestId('start-run').click()
    await waitScene('find')
    await page.waitForTimeout(500)
    await shot('04-find-start')
    await tapWorld(602, 772) // blocked by fog → hint
    await dragWorld(610, 770, 640, 1500)
    await page.waitForTimeout(300)
    await tapWorld(362, 356); await page.waitForTimeout(250)
    await tapWorld(500, 812); await page.waitForTimeout(250)
    await shot('05-find-progress')
    await tapWorld(602, 772)
    await page.getByText('渠首寻踪 完成！').waitFor({ timeout: 15000 })
    await page.waitForTimeout(300)
    await shot('06-result')
  })

  await step('tutorial: plant mint, instant grow, claim', async () => {
    await page.getByRole('button', { name: '去小院' }).click()
    await waitScene('garden')
    await page.waitForTimeout(1200)
    await tapWorld(124, 1546)
    await page.waitForTimeout(400)
    await shot('07a-plot-sheet')
    await page.getByTestId('plant-seed_mint').click({ timeout: 8000 })
    await confirmWrite(/已种下/, 20000)
    await page.waitForTimeout(500)
    await tapWorld(124, 1546)
    await page.getByTestId('claim-plant').click()
    await confirmWrite(/已收入背包/)
    const inv = await page.evaluate(() => window.__bcy.snapshot.state.inventory.plant_mint)
    if (inv !== 1) throw new Error(`claim applied ${inv} times (expected exactly 1)`)
    await page.waitForTimeout(500)
  })

  await step('decorate + save', async () => {
    await page.getByTestId('edit-garden').click()
    await page.getByTestId('add-plant_mint').click()
    await page.getByTestId('add-decor_bench').click()
    await page.waitForTimeout(300)
    await dragWorld(237, 560, 450, 1000)
    await page.waitForTimeout(300)
    await shot('07-garden-edit')
    await page.getByTestId('save-garden').click()
    await confirmWrite(/小院布置已保存/, 20000)
    await page.waitForTimeout(500)
    await shot('08-garden-saved')
  })

  await step('dujiangyan puzzle (wrong drop + snap)', async () => {
    await page.getByTestId('nav-map').click()
    await page.locator('.map-node').first().locator('.chip').nth(1).click()
    await page.getByTestId('route-decor').click()
    await page.getByTestId('start-run').click()
    await waitScene('puzzle')
    await page.waitForTimeout(400)
    await shot('09-puzzle-start')
    const pieces = await page.evaluate(() => window.__phaser.scene.getScene('puzzle').children.list
      .filter(o => o.type === 'Image' && /_piece_/.test(o.frame?.name ?? '')).map(o => ({ name: o.frame.name, x: o.x, y: o.y })))
    if (pieces.length !== 4) throw new Error(`expected 4 pieces, got ${JSON.stringify(pieces)}`)
    const target = i => ({ x: 90 + (i % 2) * 450 + 225, y: 70 + Math.floor(i / 2) * 600 + 300 })
    const idx = n => Number(n.split('_').pop())
    const w = target(idx(pieces[0].name) === 0 ? 3 : 0)
    await dragWorld(pieces[0].x, pieces[0].y, w.x, w.y); await page.waitForTimeout(500)
    for (const p of pieces) { const t = target(idx(p.name)); await dragWorld(p.x, p.y, t.x, t.y); await page.waitForTimeout(300) }
    await page.getByText('渠首拼图 完成！').waitFor({ timeout: 15000 })
    await page.waitForTimeout(300)
    await shot('10-puzzle-result')
  })

  await step('share export + codex', async () => {
    await page.getByRole('button', { name: '继续游览' }).click()
    await page.getByTestId('nav-share').click()
    await page.getByTestId('make-share').click()
    // first export downloads the full-size frame + scene art; allow for a slow link
    await page.getByTestId('share-preview').waitFor({ timeout: 45000 })
    await page.waitForTimeout(500)
    await shot('11-share')
    const size = await page.evaluate(() => { const img = document.querySelector('[data-testid=share-preview]'); return `${img.naturalWidth}x${img.naturalHeight}` })
    if (size !== '1080x1440') throw new Error(`bad export size ${size}`)
    // F13: local photo — real gesture path, GPS-EXIF fixture, crop drag, nothing leaves the device.
    const sent = []
    const onReq = r => { const b = r.postDataBuffer(); if (b && (b.length > 20000 || b.includes('Exif') || b.includes(Buffer.from([0xff, 0xd8, 0xff])))) sent.push(`${r.method()} ${r.url()} ${b.length}B`) }
    page.on('request', onReq)
    await page.getByTestId('photo-add').click()
    await page.getByText('照片只在你的手机里合成，不会上传').first().waitFor({ timeout: 5000 })
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: '选择照片' }).click()])
    await chooser.setFiles(new URL('../tests/fixtures/photo_gps.jpg', import.meta.url).pathname)
    const crop = page.getByTestId('photo-crop'); await crop.waitFor({ timeout: 10000 })
    const cb = await crop.boundingBox()
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(cb.x + cb.width / 2 + i * 6, cb.y + cb.height / 2 + i * 10)
    await page.mouse.up()
    await page.getByTestId('photo-zoom').fill('1.6')
    await page.getByTestId('make-share').click()
    await page.getByTestId('share-preview').waitFor({ timeout: 15000 }); await page.waitForTimeout(400)
    await shot('11b-share-photo')
    const chk = await page.evaluate(async () => {
      const img = document.querySelector('[data-testid=share-preview]')
      let buf = null
      try { buf = new Uint8Array(await (await fetch(img.src)).arrayBuffer()) } catch { /* production CSP blocks connect-src blob: — chunk check verified on local runs */ }
      // Walk PNG chunks: only IHDR/IDAT/IEND (+ harmless sRGB/gAMA/pHYs) are allowed — no eXIf/tEXt/iTXt/zTXt metadata.
      const chunks = []
      if (!buf) chunks.push('skipped-by-CSP')
      else for (let o = 8, dv = new DataView(buf.buffer); o + 8 <= buf.length;) { const len = dv.getUint32(o); chunks.push(String.fromCharCode(...buf.subarray(o + 4, o + 8))); o += 12 + len }
      const c = document.createElement('canvas'); c.width = 1080; c.height = 1440; const g = c.getContext('2d'); g.drawImage(img, 0, 0)
      const px = Array.from(g.getImageData(696 + 200, 730 + 200, 1, 1).data)
      return { png: !buf || (buf[1] === 0x50 && buf[2] === 0x4e), exif: !!buf && chunks.some(t => !['IHDR', 'IDAT', 'IEND', 'sRGB', 'gAMA', 'pHYs', 'iCCP', 'cHRM'].includes(t)), chunks: [...new Set(chunks)], px }
    })
    if (!chk.png || chk.exif) throw new Error(`export not clean PNG ${JSON.stringify(chk)}`)
    if (!(chk.px[0] > 150 && chk.px[1] < 110 && chk.px[2] > 110)) throw new Error(`photo not composited at photo rect, pixel ${chk.px}`)
    await page.getByTestId('photo-remove').click()
    await page.getByTestId('make-share').click(); await page.getByTestId('share-preview').waitFor({ timeout: 15000 })
    page.off('request', onReq)
    if (sent.length) throw new Error(`photo-like payload left the device: ${sent.join('; ')}`)
    console.log(`(photo: composited, PNG chunks ${chk.chunks.join('/')}, 0 uploads)`)
    await page.evaluate(() => { const a = document.createElement('a'); a.id = 'dl'; a.href = document.querySelector('[data-testid=share-preview]').src; document.body.append(a) })
    await page.getByTestId('nav-codex').click(); await page.waitForTimeout(500); await shot('12-codex')
    // v2.1: plant card + quiz stamp
    await page.getByTestId('codex-mint').click(); await page.waitForTimeout(300); await shot('12a-plant-card')
    await page.getByTestId('open-quiz').click()
    for (let q = 0; q < 3; q++) {
      for (let i = 0; i < 3; i++) {
        await page.getByTestId(`quiz-opt-${i}`).click()
        if (await page.getByTestId('quiz-next').count()) break
        await page.getByText('重新选择').click()
      }
      await page.getByTestId('quiz-next').click(); await page.waitForTimeout(q < 2 ? 100 : 1500)
    }
    await page.getByText('印章').first().waitFor({ timeout: 20000 })
    await shot('12b-quiz-done')
    await page.keyboard.press('Escape').catch(() => {})
    await page.locator('.sheet-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(300)
    // A7: notebook, visitor codex, titles and the F25 nature journal
    await page.getByTestId('open-notebook').click()
    await page.getByTestId('notebook').waitFor({ timeout: 10000 })
    await page.getByTestId('notebook-mint').waitFor({ timeout: 10000 })
    await shot('12c-notebook')
    await page.getByRole('button', { name: '返回图鉴' }).click()
    await page.getByTestId('codex').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: /访客/ }).click()
    await page.getByTestId('visitor-codex-bulbul').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: /小景/ }).click()
    await page.getByTestId('titles').waitFor({ timeout: 10000 })
    await page.getByTestId('nav-share').click()
    await page.getByRole('button', { name: '自然笔记' }).click()
    await page.getByTestId('make-share').click()
    await page.getByTestId('share-preview').waitFor({ timeout: 45000 })
    const natureSize = await page.evaluate(() => { const img = document.querySelector('[data-testid=share-preview]'); return `${img.naturalWidth}x${img.naturalHeight}` })
    if (natureSize !== '1080x1440') throw new Error(`bad nature export size ${natureSize}`)
    await page.waitForTimeout(300); await shot('12d-nature-journal')
    await page.getByTestId('nav-codex').click()
    // v2.1: solar-term calendar
    await page.getByTestId('nav-season').click(); await page.waitForTimeout(500); await shot('14-season')
    const claim = page.locator('[data-testid^="claim-"]:not([disabled])').first()
    // a write may legitimately still be on the wire; it must settle within 10 s, never stay 'unknown'
    await page.waitForFunction(() => !localStorage.getItem('bcy.pendingWrite'), null, { timeout: 10000 }).catch(() => {})
    // A response lost on the wire leaves the write 'unknown' with the 结果还没确认 banner — recover like a user (重试确认),
    // the server must replay its receipt. Anything still pending after that is a real bug.
    for (let i = 0; i < 3 && (await page.evaluate(() => !!localStorage.getItem('bcy.pendingWrite'))); i++) {
      const retry = page.getByRole('button', { name: '重试确认' }).first()
      if (await retry.count()) { recoveries++; console.log(`  (lost response → 重试确认 #${recoveries})`); await retry.click() }
      await page.waitForFunction(() => !localStorage.getItem('bcy.pendingWrite'), null, { timeout: 15000 }).catch(() => {})
    }
    const stuck = await page.evaluate(() => Object.keys(localStorage).filter(k => /pending/i.test(k)).map(k => `${k}=${(localStorage.getItem(k) || '').slice(0, 160)}`))
    if (stuck.length) throw new Error(`a write is still pending before the season claim: ${stuck.join(' | ')}`)
    if (await claim.count()) { await claim.click(); await page.getByText('信笺').first().waitFor({ timeout: 20000 }); await page.waitForTimeout(800); await shot('14a-season-claimed') }
    // v2.1: craft bench + settings
    await page.getByTestId('nav-inventory').click(); await page.waitForTimeout(300)
    await page.getByTestId('open-craft').click(); await page.waitForTimeout(300); await shot('15-craft')
    await page.locator('.sheet-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.locator('button[aria-label="设置"]').click(); await page.waitForTimeout(300); await shot('16-settings')
    await page.getByTestId('nav-map').click(); await page.waitForTimeout(500); await shot('13-map-after')
    // F12: trip cards — A5 G3 gave dujiangyan its 3rd verified fact (season, official source), so it now shows too.
    await page.getByRole('button', { name: '都江堰', exact: false }).first().click(); await page.waitForTimeout(300)
    await page.getByTestId('trip-link-dujiangyan').click()
    await page.getByTestId('trip-card').waitFor({ timeout: 5000 })
    for (const t of ['适合季节', '核实于', '非景区官方发布']) await page.getByText(t, { exact: false }).first().waitFor({ timeout: 3000 })
    await page.waitForTimeout(300); await shot('17a-trip-card-dujiangyan')
    await page.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(200)
    await page.locator('.sheet-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.getByRole('button', { name: '青城山', exact: false }).first().click()
    // 2026-10-25 content review: the qingcheng walking/stroller fields were only inferred from “丹梯千级” and
    // are hidden under A6-A4b. With fewer than minDisplayedFacts verified facts the whole card is hidden.
    if (await page.getByTestId('trip-link-qingcheng').count()) {
      await page.getByTestId('trip-link-qingcheng').click()
      await page.getByTestId('trip-card').waitFor({ timeout: 5000 })
      for (const t of ['开放时间、票价、交通以景区官方公告为准', '本卡为游戏内参考信息，非景区官方发布', '步行强度', '核实于']) await page.getByText(t, { exact: false }).first().waitFor({ timeout: 3000 })
      if (await page.locator('[data-testid=trip-card] a').count()) throw new Error('trip card must not contain links')
      await page.waitForTimeout(400); await shot('17-trip-card')
    } else {
      console.log('(qingcheng trip card hidden: <3 verified facts after 2026-10-25 review)')
    }
    await page.waitForTimeout(200)
    await page.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.locator('.sheet-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
  })

  await step('A6 surfaces: map entries, field checklist, care, carousel, settings', async () => {
    await page.getByTestId('nav-map').click(); await page.waitForTimeout(300)
    await page.getByTestId('map-craft').waitFor({ timeout: 5000 })
    await page.getByTestId('map-field').click(); await page.waitForTimeout(400); await shot('18-field-checklist')
    await page.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(200)
    await page.getByTestId('nav-garden').click(); await page.waitForTimeout(800)
    await page.getByTestId('care-open').click(); await page.waitForTimeout(300)
    const careBtn = page.locator('[data-testid^=care-btn-]:not([disabled])').first()
    if (!(await careBtn.count())) throw new Error('care sheet shows no carable plant (mint should be mature)')
    await careBtn.click()
    await page.waitForFunction(() => Object.values(window.__bcy.snapshot.state.care ?? {}).some(d => d.length >= 1), null, { timeout: 20000 })
    await page.waitForTimeout(400); await shot('19-care')
    await page.locator('.sheet-backdrop').last().click({ position: { x: 5, y: 5 } }); await page.waitForTimeout(200)
    await page.getByTestId('nav-share').click(); await page.waitForTimeout(300)
    await page.getByTestId('blogger-kit').scrollIntoViewIfNeeded()
    await page.getByTestId('carousel').click()
    await page.locator('[data-testid=carousel-out] img').nth(3).waitFor({ timeout: 30000 })
    await page.waitForTimeout(300); await shot('20-carousel')
    await page.locator('button[aria-label="设置"]').click(); await page.waitForTimeout(300)
    for (const id of ['ambient', 'sound']) await page.getByTestId(id).first().waitFor({ timeout: 5000 })
    // the age chips only appear with parent mode on
    const pm = page.getByTestId('parent-mode'); const wasOn = await pm.isChecked()
    if (!wasOn) await pm.check()
    await page.getByTestId('kid-age').getByRole('button', { name: '7-12' }).click()
    await shot('21-settings-a6')
    await page.getByTestId('kid-age').getByRole('button', { name: '3-6' }).click()
    if (!wasOn) await pm.uncheck()
  })

  const state = await page.evaluate(() => window.__bcy.snapshot.state)
  console.log('inventory', JSON.stringify(state.inventory), '| tutorial', state.tutorialStage, '| placements', state.garden.placements.length, '| palettes', state.unlockedPaletteIds.join(','))
  if (state.tutorialStage !== 'complete') throw new Error('tutorial did not complete')
  if (errors.length) throw new Error(errors.join('\n'))
  // After deletion the session is revoked, so the still-open page's polling gets 401 by design — stop collecting first.
  if (realname) { errors.frozen = true; await page.evaluate(() => window.__bcy.accountDelete()); console.log('test account deleted') }
  if (recoveries) console.log(`(${recoveries} lost response(s) recovered via 重试确认, no double-apply)`)
  console.log(`SMOKE OK — screenshots in ${out}/`)
} catch (e) {
  await shot('zz-failure').catch(() => {})
  console.error('SMOKE FAIL —', e.message, errors.length ? `\n${errors.join('\n')}` : '')
  process.exitCode = 1
} finally { await browser.close() }
