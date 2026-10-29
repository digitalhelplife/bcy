// Injected into a temporary same-origin copy of index.html on the live server.
// Drives the real game in the iPhone's Safari with DOM clicks + synthetic mouse events
// (Phaser listens to mouse/touch, not PointerEvent), then shows a PASS/FAIL overlay that
// can be read from a device screenshot. No app install, no Web Inspector required.
(() => {
  // `?fresh=N` starts a brand-new trial account (the tutorial's instant-grow only applies once).
  const freshRun = new URLSearchParams(location.search).get('fresh')
  if (freshRun && !sessionStorage.getItem('__autotest_fresh_' + freshRun)) {
    localStorage.clear()
    sessionStorage.setItem('__autotest_fresh_' + freshRun, '1')
    location.reload()
    return
  }
  if (window.__autotestStarted) return
  window.__autotestStarted = true
  const REPORT = { steps: [], errors: [], startedAt: Date.now(), done: false, ok: false, final: null }
  window.__autotestReport = REPORT
  const lines = []
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:6px;right:6px;top:6px;z-index:2147483647;pointer-events:none;background:rgba(0,0,0,.82);color:#9f9;font:12px/1.32 ui-monospace,Menlo,monospace;padding:6px 9px;border-radius:8px;white-space:pre-wrap;max-height:44vh;overflow:hidden'
  const mount = () => (document.body || document.documentElement).appendChild(box)
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
  const render = () => { box.textContent = lines.slice(-14).join('\n') }
  const log = s => { lines.push(s); render() }
  function rec(name, ok, detail) {
    REPORT.steps.push({ name, ok, detail: detail == null ? null : String(detail).slice(0, 240) })
    log((ok ? '✓ ' : '✗ ') + name + (detail != null ? ' — ' + String(detail).slice(0, 100) : ''))
  }
  window.addEventListener('error', e => { REPORT.errors.push('error: ' + (e.message || e.type)) })
  window.addEventListener('unhandledrejection', e => { REPORT.errors.push('rejection: ' + String(e.reason)) })

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const $ = s => document.querySelector(s)
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  async function waitFor(sel, timeout = 30000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) { const el = $(sel); if (visible(el)) return el; await sleep(250) }
    throw new Error('timeout ' + sel)
  }
  async function waitText(text, timeout = 30000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      if ((document.body ? document.body.innerText : '').includes(text)) return true
      await sleep(300)
    }
    throw new Error('timeout text: ' + text)
  }
  async function waitEnabled(sel, timeout = 25000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      const el = $(sel)
      if (visible(el) && !el.disabled) return el
      await sleep(250)
    }
    throw new Error('timeout enabled: ' + sel)
  }
  async function waitEval(fn, timeout = 25000, label = 'condition') {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { if (fn()) return true } catch (e) { /* keep polling */ }
      await sleep(300)
    }
    throw new Error('timeout ' + label)
  }
  function clickSel(sel) {
    const el = $(sel)
    if (!el) throw new Error('missing ' + sel)
    el.scrollIntoView({ block: 'center' }); el.click(); return true
  }
  function clickText(text, exact = false) {
    const els = Array.from(document.querySelectorAll('button,a,[role=button],label'))
    const el = els.find(e => visible(e) && !e.disabled && (exact ? (e.textContent || '').trim() === text : (e.textContent || '').includes(text)))
    if (!el) throw new Error('no clickable text: ' + text)
    el.scrollIntoView({ block: 'center' }); el.click(); return (el.textContent || '').trim().slice(0, 40)
  }
  function canvasEl() {
    const c = $('.phaser-host canvas')
    if (!visible(c)) throw new Error('no canvas')
    return c
  }
  function pt(wx, wy) {
    const c = canvasEl(); const r = c.getBoundingClientRect()
    return { c, x: r.left + wx * r.width / 1080, y: r.top + wy * r.height / 1920 }
  }
  function fire(c, type, p, buttons) {
    c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons }))
    c.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, button: 0, buttons, view: window }))
  }
  async function tapWorld(wx, wy) {
    const { c, x, y } = pt(wx, wy)
    fire(c, 'pointerdown', { x, y }, 1); fire(c, 'mousedown', { x, y }, 1)
    await sleep(90)
    fire(c, 'pointerup', { x, y }, 0); fire(c, 'mouseup', { x, y }, 0)
  }
  async function dragWorld(x1, y1, x2, y2, steps = 16) {
    const a = pt(x1, y1); const b = pt(x2, y2)
    fire(a.c, 'pointerdown', a, 1); fire(a.c, 'mousedown', a, 1)
    await sleep(100)
    for (let i = 1; i <= steps; i++) {
      const q = { x: a.x + (b.x - a.x) * i / steps, y: a.y + (b.y - a.y) * i / steps }
      fire(a.c, 'pointermove', q, 1); fire(a.c, 'mousemove', q, 1)
      await sleep(35)
    }
    await sleep(60)
    fire(a.c, 'pointerup', b, 0); fire(a.c, 'mouseup', b, 0)
  }
  async function touchDrag(selector, dx, dy) {
    const all = Array.from(document.querySelectorAll(selector))
    const host = all[all.length - 1]
    if (!host) throw new Error('no ' + selector)
    const r = host.getBoundingClientRect()
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const ev = (t, px, py, b) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: px, clientY: py, button: 0, buttons: b })
    host.dispatchEvent(ev('pointerdown', x, y, 1))
    await sleep(40)
    for (let i = 1; i <= 8; i++) { host.dispatchEvent(ev('pointermove', x + dx * i / 8, y + dy * i / 8, 1)); await sleep(20) }
    host.dispatchEvent(ev('pointerup', x + dx, y + dy, 0))
    await sleep(250)
  }
  async function pinch(selector, from, to) {
    const all = Array.from(document.querySelectorAll(selector))
    const host = all[all.length - 1]
    if (!host) throw new Error('no ' + selector)
    const r = host.getBoundingClientRect()
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    const ev = (t, id, x, y, b) => new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, button: 0, buttons: b })
    host.dispatchEvent(ev('pointerdown', 1, cx - from, cy, 1))
    host.dispatchEvent(ev('pointerdown', 2, cx + from, cy, 1))
    await sleep(40)
    host.dispatchEvent(ev('pointermove', 1, cx - to, cy, 1))
    host.dispatchEvent(ev('pointermove', 2, cx + to, cy, 1))
    await sleep(40)
    host.dispatchEvent(ev('pointerup', 1, cx - to, cy, 0))
    host.dispatchEvent(ev('pointerup', 2, cx + to, cy, 0))
    await sleep(250)
  }
  function scaleOf(selector) {
    const all = Array.from(document.querySelectorAll(selector))
    const el = all[all.length - 1]
    const m = (el && el.style.transform ? el.style.transform : '').match(/scale\(([^)]+)\)/)
    return m ? parseFloat(m[1]) : 1
  }
  function state() { return window.__bcy && window.__bcy.snapshot }
  function orderFor(seed) {
    let a = seed >>> 0
    const rand = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
    const order = Array.from({ length: 4 }, (_, i) => i)
    for (let i = 3; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
    if (order.every((v, i) => v === i)) order.push(order.shift())
    return order
  }
  function finish() {
    const passed = REPORT.steps.filter(s => s.ok).length
    const failed = REPORT.steps.filter(s => !s.ok)
    REPORT.ok = REPORT.done && failed.length === 0
    box.style.color = REPORT.ok ? '#7f7' : '#f77'
    box.style.background = REPORT.ok ? 'rgba(0,40,0,.9)' : 'rgba(60,0,0,.92)'
    log('==============================')
    log('AUTOTEST ' + (REPORT.ok ? 'PASS' : 'FAIL') + '  ' + passed + '/' + REPORT.steps.length)
    if (REPORT.errors.length) log('errors: ' + REPORT.errors.slice(0, 4).join(' | ').slice(0, 220))
  }
  async function run() {
    try {
      // Wait until either the consent gate or the landing button exists.
      const t0 = Date.now()
      while (Date.now() - t0 < 90000 && !visible($('[data-testid=consent-agree]')) && !visible($('[data-testid=enter]'))) await sleep(300)
      if (visible($('[data-testid=consent-agree]'))) {
        $('[data-testid=consent-agree]').click()
        await sleep(500)
        ;(await waitEnabled('[data-testid=consent-accept]', 8000)).click()
        rec('consent', true)
        await sleep(1200)
      } else rec('consent', true, 'already accepted')

      ;(await waitFor('[data-testid=enter]', 90000)).click()
      await waitText('都江堰水利工程', 45000)
      rec('map', true)
      try {
        await pinch('.map-viewport', 40, 60)
        const z = scaleOf('.map-zoom-layer') > 1
        await pinch('.map-viewport', 60, 15)
        rec('map-pinch', z && Math.abs(scaleOf('.map-zoom-layer') - 1) < 0.02, 'zoom=' + z)
      } catch (e) { rec('map-pinch', false, e && e.message ? e.message : String(e)) }

      clickText('寻踪', true)
      await waitFor('[data-testid=route-plant]', 15000)
      clickSel('[data-testid=route-plant]')
      ;(await waitEnabled('[data-testid=start-run]', 15000)).click()
      await waitFor('.phaser-host canvas', 60000)
      await sleep(1800)
      rec('find-scene', true)
      await sleep(20000) // keep the find scene on screen long enough for the DVT capture
      try {
        const c = [...document.querySelectorAll('.phaser-host canvas')].pop()
        const t0 = c ? c.style.transform : ''
        await touchDrag('.phaser-host', 40, -30)
        const c2 = [...document.querySelectorAll('.phaser-host canvas')].pop()
        rec('find-move', !!c2 && (c2.style.transform || '') !== t0, 'pan')
        await pinch('.phaser-host', 40, 45)
        const z = scaleOf('.phaser-host canvas') > 1
        await sleep(600)
        await pinch('.phaser-host', 80, 10)
        const reset = scaleOf('.phaser-host canvas')
        rec('find-pinch', z && Math.abs(reset - 1) < 0.02, 'zoom=' + z + ', reset=' + reset)
      } catch (e) { rec('find-pinch', false, e && e.message ? e.message : String(e)) }

      await dragWorld(610, 770, 860, 900)
      await sleep(900)
      await tapWorld(362, 356); await sleep(900)
      await tapWorld(500, 812); await sleep(900)
      await tapWorld(602, 772)
      await waitText('完成', 30000)
      rec('find-complete', true, '3/3')

      clickText('去小院', true)
      await waitFor('.phaser-host canvas', 30000)
      await sleep(1500)
      await sleep(20000) // keep the garden on screen long enough for the DVT capture
      try {
        await pinch('.phaser-host', 40, 60)
        const z = scaleOf('.phaser-host canvas') > 1
        await pinch('.phaser-host', 60, 15)
        rec('garden-pinch', z && Math.abs(scaleOf('.phaser-host canvas') - 1) < 0.02, 'zoom=' + z)
      } catch (e) { rec('garden-pinch', false, e && e.message ? e.message : String(e)) }
      await tapWorld(124, 1506)
      await waitFor('[data-testid=plant-seed_mint]', 15000)
      rec('garden-slot-sheet', true)
      clickSel('[data-testid=plant-seed_mint]')
      ;(await waitEnabled('[data-testid=claim-plant]', 25000)).click()
      await waitEval(() => (state()?.state?.inventory?.plant_mint ?? 0) >= 1, 25000, 'mint claimed into inventory')
      rec('instant-mature-claimed', true)
      ;(await waitEnabled('[data-testid=edit-garden]', 20000)).click()
      ;(await waitEnabled('[data-testid=garden-auto]', 15000)).click()
      await waitText('摆一摆', 8000)
      clickText('摆一摆', true)
      await sleep(900)
      ;(await waitEnabled('[data-testid=save-garden]', 15000)).click()
      await waitText('已保存', 25000)
      rec('garden-saved', true, state()?.state?.garden?.placements?.length)

      clickSel('[data-testid=nav-share]')
      ;(await waitEnabled('[data-testid=make-share]', 20000)).click()
      const img = await waitFor('[data-testid=share-preview]', 40000)
      rec('journal', img.naturalWidth === 1080 && img.naturalHeight === 1440, img.naturalWidth + 'x' + img.naturalHeight)

      clickSel('[data-testid=nav-map]')
      await waitText('都江堰水利工程', 20000)
      clickText('拼图', true)
      ;(await waitEnabled('[data-testid=start-run]', 15000)).click()
      await waitFor('.phaser-host canvas', 60000)
      await sleep(1800)
      await sleep(20000) // keep the puzzle scene on screen long enough for the DVT capture
      const seed = state()?.activeRun?.shuffleSeed
      if (!Number.isFinite(seed)) throw new Error('no shuffle seed')
      const order = orderFor(seed)
      const targets = [[315, 370], [765, 370], [315, 970], [765, 970]]
      const tray = [[157.5, 1600], [412.5, 1600], [667.5, 1600], [922.5, 1600]]
      for (let i = 0; i < 4; i++) {
        await dragWorld(tray[i][0], tray[i][1], targets[order[i]][0], targets[order[i]][1])
        await sleep(800)
      }
      await waitText('完成', 30000)
      rec('puzzle-complete', true, '4/4')

      const st = state()
      REPORT.final = {
        levels: st?.state?.levels,
        inventory: st?.state?.inventory,
        placements: st?.state?.garden?.placements?.length,
        discovered: st?.state?.discoveredPlantIds,
      }
      REPORT.done = true
    } catch (e) {
      REPORT.done = true
      REPORT.errors.push('fatal: ' + (e && e.message ? e.message : String(e)))
      rec('fatal', false, e && e.message ? e.message : String(e))
    } finally {
      finish()
    }
  }
  setTimeout(run, 3000)
})()
