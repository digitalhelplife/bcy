// Static admin console served by bencao-auth at /admin/. No framework, no inline script (strict CSP),
// and every server-provided string is rendered with textContent.
export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>本草小游记 · 合规后台</title>
<link rel="stylesheet" href="/admin/app.css"></head>
<body>
<header><h1>本草小游记 · 合规后台</h1><span id="envTag" class="tag"></span><button id="logoutBtn" class="ghost" hidden>退出</button></header>
<main>
  <section id="loginView" class="card" hidden>
    <h2>管理员登录</h2>
    <form id="loginForm"><label>管理员密码<input id="pw" type="password" autocomplete="current-password" required maxlength="256"></label>
    <button type="submit">登录</button><p id="loginMsg" class="err" role="alert"></p></form>
  </section>

  <div id="appView" hidden>
    <section class="card">
      <h2>当前状态</h2>
      <p id="summary" class="summary"></p>
      <p class="muted" id="versionLine"></p>
      <div class="stats" id="stats"></div>
    </section>

    <form id="cfgForm">
      <section class="card">
        <h2>实名认证</h2>
        <label class="switch"><input type="checkbox" id="realname"> <span>开启手机号登录 + 实名认证</span></label>
        <p class="muted">关闭时：玩家用浏览器试玩账号直接进入，不收集手机号和身份信息，未成年人规则不生效。<br>
        开启时：玩家必须用手机号登录并完成实名，才能进入游戏。</p>
        <p class="warn">切换后，玩家下次打开或刷新游戏时改用新的登录方式。手机号账号和试玩账号是两个独立账号，进度不互通。</p>
      </section>

      <section class="card" id="minorCard">
        <h2>未成年人保护（防沉迷）</h2>
        <p class="muted" id="minorNeedsRealname">需要开启实名认证才能识别未成年人；实名关闭时以下设置暂不生效，但会保存。</p>
        <fieldset><legend>策略</legend>
          <label class="radio"><input type="radio" name="mode" value="window"> 按时段限制（国家规定：周五、周六、周日和法定节假日 20:00–21:00）</label>
          <label class="radio"><input type="radio" name="mode" value="block"> 完全禁止未成年人进入</label>
          <label class="radio"><input type="radio" name="mode" value="off"> 不限制（仅测试环境可用）</label>
        </fieldset>
        <div id="windowFields">
          <fieldset><legend>可游戏的日子</legend><div class="days" id="days"></div>
            <label class="switch"><input type="checkbox" id="holidays"> <span>包含法定节假日</span></label></fieldset>
          <fieldset class="hours"><legend>可游戏时段（北京时间）</legend>
            <label>从 <select id="startHour"></select></label><label>到 <select id="endHour"></select></label>
            <button type="button" id="legalBtn" class="ghost small">恢复国家规定</button></fieldset>
        </div>
        <p class="preview" id="preview"></p>
      </section>

      <section class="card">
        <h2>保存</h2>
        <label>变更说明（可选，会记入历史）<input id="note" maxlength="200" placeholder="例如：内测阶段关闭实名"></label>
        <ul id="errors" class="err" role="alert"></ul>
        <div class="row"><button type="submit" id="saveBtn">保存配置</button><button type="button" id="resetBtn" class="ghost">放弃修改</button></div>
        <p id="saveMsg" class="ok" role="status"></p>
        <p class="muted">保存后约 10 秒内在游戏服务器生效，无需重启。每次修改都会记录在审计日志中。</p>
      </section>
    </form>

    <section class="card">
      <h2>变更历史（最近 20 次）</h2>
      <ol id="history" class="history"></ol>
    </section>
  </div>
</main>
<script src="/admin/app.js"></script>
</body></html>`

export const ADMIN_CSS = `
:root{--g:#2f6f62;--g2:#e6f1ee;--bd:#d9e2dc;--tx:#23302b;--mu:#66756f;--er:#b3261e;--wa:#8a5a00}
*{box-sizing:border-box}body{margin:0;font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--tx);background:#f6f4ee}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:#fff;border-bottom:1px solid var(--bd);position:sticky;top:0}
h1{font-size:18px;margin:0;flex:1}h2{font-size:16px;margin:0 0 10px}
main{max-width:760px;margin:0 auto;padding:16px}
.card{background:#fff;border:1px solid var(--bd);border-radius:12px;padding:16px 18px;margin:0 0 14px}
.tag{font-size:12px;padding:2px 10px;border-radius:999px;background:var(--g2);color:var(--g)}.tag.prod{background:#fde7e4;color:var(--er)}
label{display:block;margin:8px 0}input[type=password],input:not([type]),select{font:inherit;padding:8px 10px;border:1px solid var(--bd);border-radius:8px;width:100%;max-width:420px;display:block;margin-top:4px}
select{width:auto;display:inline-block}
.switch,.radio{display:flex;gap:8px;align-items:flex-start;cursor:pointer}.switch input,.radio input{margin-top:5px}
fieldset{border:1px solid var(--bd);border-radius:10px;margin:10px 0;padding:8px 12px}legend{color:var(--mu);font-size:13px;padding:0 4px}
.days{display:flex;flex-wrap:wrap;gap:6px 14px}.days label{display:flex;gap:4px;margin:4px 0}
.hours label{display:inline-block;margin-right:14px}
button{font:inherit;min-height:40px;padding:6px 18px;border-radius:10px;border:1px solid var(--g);background:var(--g);color:#fff;cursor:pointer}
button.ghost{background:#fff;color:var(--g)}button.small{min-height:32px;padding:2px 12px;font-size:13px}button:disabled{opacity:.5;cursor:default}
.row{display:flex;gap:10px;flex-wrap:wrap}
.muted{color:var(--mu);font-size:13px}.warn{color:var(--wa);font-size:13px}.err{color:var(--er);font-size:14px}.ok{color:var(--g);font-size:14px}
ul.err{padding-left:18px;margin:6px 0}
.summary{font-size:16px;font-weight:600;margin:4px 0}.preview{background:var(--g2);border-radius:8px;padding:8px 12px}
.stats{display:flex;flex-wrap:wrap;gap:8px}.stat{border:1px solid var(--bd);border-radius:8px;padding:6px 12px;font-size:13px}.stat b{font-size:16px;display:block}
.history{padding-left:20px;margin:0}.history li{margin:6px 0}.history .meta{color:var(--mu);font-size:12px}
.disabled{opacity:.55}
`

export const ADMIN_JS = `(() => {
  'use strict'
  const $ = id => document.getElementById(id)
  const WK = ['日', '一', '二', '三', '四', '五', '六'], ORDER = [1, 2, 3, 4, 5, 6, 0]
  const LEGAL = { mode: 'window', startHour: 20, endHour: 21, days: [0, 5, 6], includeHolidays: true }
  let loaded = null, production = false

  async function api(path, body) {
    const init = body === undefined ? { credentials: 'same-origin', cache: 'no-store' }
      : { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-bcy-admin': '1' }, body: JSON.stringify(body) }
    let r; try { r = await fetch('/admin/api/' + path, init) } catch { throw { message: '网络不可用，请检查网络后重试' } }
    let j = null; try { j = await r.json() } catch {}
    if (j && j.ok) return j.data
    throw (j && j.error) || { code: 'HTTP_' + r.status, message: '服务暂时不可用（HTTP ' + r.status + '）' }
  }
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e }
  const hh = h => String(h).padStart(2, '0') + ':00'
  const fmtTime = ms => new Date(ms).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })

  const canon = c => JSON.stringify([c.realnameEnabled, c.minor.mode, c.minor.startHour, c.minor.endHour, [...c.minor.days].sort((a, b) => a - b), c.minor.includeHolidays])
  function describe(m) {
    if (m.mode === 'block') return '本游戏暂不向未成年人提供服务'
    if (m.mode === 'off') return '未成年人不限时（测试环境）'
    const days = ORDER.filter(d => m.days.includes(d)).map(d => '周' + WK[d])
    const when = [days.join('、'), m.includeHolidays ? '法定节假日' : ''].filter(Boolean).join('和')
    return '未成年人仅可在' + (when || '（未选择日子）') + '的 ' + hh(m.startHour) + '–' + hh(m.endHour) + ' 游戏'
  }
  function summaryOf(c) {
    if (!c.realnameEnabled) return '实名认证：关闭（试玩模式，未成年人规则不生效）'
    return '实名认证：开启 · ' + describe(c.minor)
  }

  function buildStatic() {
    const days = $('days')
    for (const d of ORDER) { const l = el('label'); const i = document.createElement('input'); i.type = 'checkbox'; i.value = String(d); i.name = 'day'; l.append(i, ' 周' + WK[d]); days.append(l) }
    for (const id of ['startHour', 'endHour']) for (let h = 0; h <= 24; h++) { const o = el('option', hh(h)); o.value = String(h); $(id).append(o) }
  }
  function readForm() {
    const mode = (document.querySelector('input[name=mode]:checked') || {}).value || 'window'
    return { realnameEnabled: $('realname').checked, minor: { mode, startHour: Number($('startHour').value), endHour: Number($('endHour').value),
      days: [...document.querySelectorAll('input[name=day]:checked')].map(i => Number(i.value)).sort((a, b) => a - b), includeHolidays: $('holidays').checked } }
  }
  function fillForm(c) {
    $('realname').checked = c.realnameEnabled
    for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === c.minor.mode
    for (const i of document.querySelectorAll('input[name=day]')) i.checked = c.minor.days.includes(Number(i.value))
    $('holidays').checked = c.minor.includeHolidays
    $('startHour').value = String(c.minor.startHour); $('endHour').value = String(c.minor.endHour)
    refresh()
  }
  function refresh() {
    const c = readForm()
    $('windowFields').classList.toggle('disabled', c.minor.mode !== 'window')
    for (const i of $('windowFields').querySelectorAll('input,select')) i.disabled = c.minor.mode !== 'window'
    $('minorNeedsRealname').hidden = c.realnameEnabled
    $('minorCard').classList.toggle('disabled', !c.realnameEnabled)
    $('preview').textContent = '预览：' + summaryOf(c)
    const offRadio = document.querySelector('input[name=mode][value=off]'); offRadio.disabled = production
    // jsonb does not keep key order → compare a canonical tuple, never raw JSON
    const dirty = !!loaded && canon(c) !== canon(loaded)
    $('saveBtn').disabled = !dirty; $('resetBtn').disabled = !dirty
  }
  function render(data) {
    loaded = data.config; production = data.production
    const tag = $('envTag'); tag.textContent = data.production ? '正式环境' : '测试环境'; tag.className = 'tag' + (data.production ? ' prod' : '')
    $('summary').textContent = summaryOf(loaded)
    $('versionLine').textContent = '配置版本 v' + loaded.version + ' · ' + (loaded.updatedAtMs ? fmtTime(loaded.updatedAtMs) : '默认') + ' · ' + loaded.updatedBy
      + ' · 短信服务 ' + data.env.sms + ' · 实名服务 ' + data.env.realname
    const st = $('stats'); st.replaceChildren()
    const s = data.stats.accountsByRealname
    for (const [k, v] of [['已实名成年', s.VERIFIED_ADULT], ['已实名未成年', s.VERIFIED_MINOR], ['实名审核中', s.PENDING], ['未实名手机号', s.UNVERIFIED], ['当前在线（实名）', data.stats.onlineVerified]]) {
      const d = el('div', undefined, 'stat'); d.append(el('b', String(v)), el('span', k)); st.append(d)
    }
    const h = $('history'); h.replaceChildren()
    for (const x of data.history) {
      const li = el('li'); li.append(el('div', 'v' + x.version + ' · ' + summaryOf(x.config)))
      li.append(el('div', fmtTime(x.updatedAtMs) + ' · ' + x.updatedBy + (x.note ? ' · ' + x.note : ''), 'meta')); h.append(li)
    }
    fillForm(loaded)
  }
  async function load() {
    const data = await api('config'); render(data)
    $('loginView').hidden = true; $('appView').hidden = false; $('logoutBtn').hidden = false
  }
  function showLogin(msg) { $('appView').hidden = true; $('logoutBtn').hidden = true; $('loginView').hidden = false; $('loginMsg').textContent = msg || ''; $('pw').focus() }

  buildStatic()
  $('cfgForm').addEventListener('input', refresh); $('cfgForm').addEventListener('change', refresh)
  $('legalBtn').addEventListener('click', () => { const c = readForm(); fillForm({ realnameEnabled: c.realnameEnabled, minor: { ...LEGAL, days: [...LEGAL.days] } }) })
  $('resetBtn').addEventListener('click', () => { fillForm(loaded); $('errors').replaceChildren(); $('saveMsg').textContent = '' })
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('loginMsg').textContent = ''
    try { await api('login', { password: $('pw').value }); $('pw').value = ''; await load() } catch (err) { $('loginMsg').textContent = err.message }
  })
  $('logoutBtn').addEventListener('click', async () => { await api('logout', {}).catch(() => {}); loaded = null; showLogin('已退出') })
  $('cfgForm').addEventListener('submit', async e => {
    e.preventDefault(); const errs = $('errors'); errs.replaceChildren(); $('saveMsg').textContent = ''
    const c = readForm()
    if (loaded.realnameEnabled && !c.realnameEnabled && !confirm('确定关闭实名认证吗？关闭后玩家将以试玩账号进入，未成年人规则不再生效。')) return
    $('saveBtn').disabled = true
    try {
      await api('config', { config: c, expectedVersion: loaded.version, note: $('note').value })
      $('note').value = ''; await load(); $('saveMsg').textContent = '已保存，约 10 秒内生效。'
    } catch (err) {
      if (err.code === 'UNAUTHORIZED') return showLogin('登录已过期，请重新登录')
      for (const m of err.errors || [err.message]) errs.append(el('li', m))
      refresh()
    }
  })
  api('session').then(s => (s.authed ? load() : showLogin())).catch(err => showLogin(err.message))
})()
`
