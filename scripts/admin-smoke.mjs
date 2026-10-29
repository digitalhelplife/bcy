#!/usr/bin/env node
// Real-browser smoke for the admin console. Requires the demo services:
//   node scripts/admin-demo-setup.mjs
//   source .env.admin-demo && node backend/auth/build/bencao-auth.mjs
//   source .env.admin-demo && node backend/admin/build/bencao-admin.mjs
// Usage: node scripts/admin-smoke.mjs [--base http://127.0.0.1:7361]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const root = resolve(new URL('..', import.meta.url).pathname)
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://127.0.0.1:7361'
const shots = join(root, 'shots-admin')
mkdirSync(shots, { recursive: true })

const consoleErrors = []
const pageErrors = []
const serverErrors = []
const IGNORE_CONSOLE = [
  'Failed to load resource: the server responded with a status of 401 (Unauthorized)',
  'Failed to load resource: the server responded with a status of 404 (Not Found)',
]
const steps = []
let shotIndex = 0

async function shot(page, name) {
  const file = join(shots, `${String(++shotIndex).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  steps.push({ name, file })
  console.log(`  · ${name} → ${file}`)
}

async function step(name, fn) {
  process.stdout.write(`▶ ${name}\n`)
  await fn()
}

async function login(page, username, password) {
  await page.goto(`${base}/admin/`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid=login-username]').waitFor({ timeout: 10000 })
  await page.fill('[data-testid=login-username]', username)
  await page.fill('[data-testid=login-password]', password)
  await page.click('[data-testid=login-submit]')
  await page.locator('.topbar-title').first().waitFor({ timeout: 15000 })
}

async function nav(page, label, expectTitle) {
  await page.locator('.nav-link', { hasText: label }).first().click()
  await page.locator('.page-title').filter({ hasText: expectTitle }).first().waitFor({ timeout: 10000 })
}

const main = async () => {
  let browser
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  } catch {
    browser = await chromium.launch({ headless: true })
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('console', msg => { if (msg.type() === 'error' && !IGNORE_CONSOLE.includes(msg.text())) consoleErrors.push(msg.text()) })
  page.on('response', r => { if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`) })
  page.on('pageerror', err => pageErrors.push(err.message))

  try {
    await step('登录页', async () => {
      await page.goto(`${base}/admin/`, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-testid=login-username]').waitFor()
      await shot(page, 'login')
    })

    await step('登录并进入总览', async () => {
      await page.fill('[data-testid=login-username]', 'owner')
      await page.fill('[data-testid=login-password]', 'BencaoDemo2026!')
      await page.click('[data-testid=login-submit]')
      await page.locator('.page-title', { hasText: '总览' }).waitFor({ timeout: 15000 })
      await page.locator('[data-testid=kpi-dau]').waitFor()
      const kpis = await page.locator('[data-testid^=kpi-]').count()
      assert.ok(kpis >= 6, `expected 6 KPI cards, got ${kpis}`)
      const funnel = await page.locator('.funnel-row').count()
      assert.ok(funnel >= 6, `expected funnel rows, got ${funnel}`)
      await shot(page, 'overview')
    })

    await step('指标口径抽屉', async () => {
      await page.getByRole('button', { name: '指标口径' }).click()
      await page.locator('.drawer-title', { hasText: '指标口径' }).waitFor()
      await shot(page, 'metric-definitions')
      await page.locator('.drawer-head button', { hasText: '关闭' }).click()
    })

    await step('用户列表与搜索', async () => {
      await nav(page, '用户查询', '用户')
      await page.locator('[data-testid=users-q]').fill('player_1')
      await page.click('[data-testid=users-apply]')
      await page.waitForResponse(r => r.url().includes('/admin/api/users?') && r.status() === 200).catch(() => undefined)
      await page.waitForTimeout(300)
      const rows = await page.locator('tbody tr').count()
      assert.ok(rows > 0, 'user search returned no rows')
      await shot(page, 'users')
    })

    await step('用户详情', async () => {
      const link = page.locator('tbody tr .btn.link').first()
      await link.click()
      await page.locator('.page-title').filter({ hasText: /^用户/ }).waitFor()
      await page.getByRole('tab', { name: '游戏进度' }).click()
      await page.getByText('关卡进度', { exact: true }).waitFor()
      await shot(page, 'user-detail')
      await page.getByRole('button', { name: '返回列表' }).click()
      await page.locator('.page-title', { hasText: '用户' }).waitFor()
    })

    await step('手机号精确查询', async () => {
      await page.fill('[data-testid=users-phone]', '13810000000')
      await page.click('[data-testid=users-phone-search]')
      await page.locator('[data-testid=phone-result]').waitFor()
      const text = await page.locator('[data-testid=phone-result]').innerText()
      assert.match(text, /138\*\*\*\*0000/, `unexpected phone result: ${text}`)
      await shot(page, 'phone-search')
    })

    await step('反馈收件箱与状态流转', async () => {
      await nav(page, '反馈收件箱', '反馈收件箱')
      await page.locator('[data-testid=feedback-open]').first().click()
      await page.locator('.drawer-title', { hasText: '反馈详情' }).waitFor()
      const reason = page.locator('[data-testid=feedback-reason]')
      if (await reason.count()) {
        await reason.fill('浏览器端到端测试：回访用户')
        await page.click('[data-testid=feedback-reveal]')
        await page.waitForTimeout(300)
      }
      await page.selectOption('[data-testid=feedback-status]', 'IN_PROGRESS')
      await page.fill('[data-testid=feedback-note]', '浏览器端到端测试备注')
      await page.click('[data-testid=feedback-save]')
      await page.locator('.toast', { hasText: '反馈状态已保存' }).waitFor()
      await shot(page, 'feedback-detail')
      await page.locator('.drawer-head button', { hasText: '关闭' }).click()
    })

    await step('内容与资产', async () => {
      await nav(page, '内容 / 审核 / 资产', '内容与资产')
      await page.waitForTimeout(400)
      await shot(page, 'content-entries')
      await page.getByRole('tab', { name: '审核台账' }).click()
      await page.getByText('审核总数', { exact: true }).waitFor()
      await shot(page, 'content-review')
      await page.getByRole('tab', { name: '美术资产' }).click()
      await page.getByText('资产总数', { exact: true }).waitFor()
      await page.waitForTimeout(500)
      await shot(page, 'content-assets')
      await page.getByRole('tab', { name: '版本与发布' }).click()
      await page.getByText('preflight 阻塞项', { exact: true }).waitFor()
      await shot(page, 'content-release')
    })

    await step('推广：渠道 / 活动 / 链接 / 二维码', async () => {
      await nav(page, '渠道与活动', '推广')
      const code = `ui_test_${Date.now().toString(36).slice(-5)}`
      await page.fill('[data-testid=channel-code]', code)
      await page.fill('[data-testid=channel-name]', 'UI 测试渠道')
      await page.click('[data-testid=channel-create]')
      await page.locator('.toast', { hasText: '渠道已创建' }).waitFor()
      await page.locator('td.mono', { hasText: code }).first().waitFor()
      await shot(page, 'promo-channels')

      await page.getByRole('tab', { name: '活动' }).click()
      await page.locator('[data-testid=campaign-channel]').selectOption({ index: 1 })
      await page.fill('[data-testid=campaign-name]', 'UI 测试活动')
      await page.click('[data-testid=campaign-create]')
      await page.locator('.toast', { hasText: '活动已创建' }).waitFor()
      await page.locator('td', { hasText: 'UI 测试活动' }).first().waitFor()
      await shot(page, 'promo-campaigns')

      await page.getByRole('tab', { name: '链接与二维码' }).click()
      await page.locator('[data-testid=link-campaign]').selectOption({ index: 1 })
      await page.click('[data-testid=link-create]')
      await page.locator('.toast', { hasText: '链接已创建' }).waitFor()
      await page.locator('[data-testid=link-qr]').first().click()
      const qr = page.locator('[data-testid=qr-image]')
      await qr.waitFor()
      await page.waitForTimeout(400)
      const dims = await qr.evaluate(img => ({ w: img.naturalWidth, h: img.naturalHeight }))
      assert.ok(dims.w > 0 && dims.h > 0, 'QR image failed to render')
      await shot(page, 'promo-qr')
      await page.locator('.drawer-head button', { hasText: '关闭' }).click()
      await page.getByRole('tab', { name: '数据' }).click()
      await page.getByText('链接点击', { exact: true }).waitFor()
      await shot(page, 'promo-data')
      await page.getByRole('tab', { name: '报表导入' }).click()
      await page.getByText('导入平台报表', { exact: true }).waitFor()
      await shot(page, 'promo-imports')

      const csvFile = join(shots, `import-${Date.now()}.csv`)
      writeFileSync(csvFile, `day,channel,campaign,impressions,clicks,spend\n2026-10-28,xhs_s1,秋假亲子打卡,${1000 + (Date.now() % 500)},80,12.5\n`)
      await page.setInputFiles('[data-testid=import-file]', csvFile)
      await page.click('[data-testid=import-preview]')
      await page.locator('.row b', { hasText: '预览' }).waitFor()
      await page.click('[data-testid=import-commit]')
      await page.locator('.toast', { hasText: /已导入|导入过/ }).waitFor()
      await shot(page, 'promo-import-result')
    })

    await step('合规与日历', async () => {
      await nav(page, '合规与日历', '合规与日历')
      await page.locator('[data-testid=config-save]').waitFor()
      await page.fill('input[placeholder*="内测阶段"]', '浏览器端到端测试')
      await page.click('[data-testid=config-save]')
      await page.locator('.toast', { hasText: '合规配置已保存' }).waitFor()
      await shot(page, 'settings-config')
    })

    await step('我的账号', async () => {
      await nav(page, '我的账号', '我的账号')
      await page.getByText('登录会话', { exact: true }).waitFor()
      await shot(page, 'settings-me')
    })

    await step('环境与版本', async () => {
      await nav(page, '环境与版本', '环境与版本')
      await page.getByText('服务健康', { exact: true }).waitFor()
      await shot(page, 'settings-environment')
    })

    await step('审计日志', async () => {
      await nav(page, '审计日志', '审计日志')
      await page.locator('tbody tr').first().waitFor()
      const rows = await page.locator('tbody tr').count()
      assert.ok(rows > 0, 'audit log is empty')
      await shot(page, 'audit')
    })

    await step('只读角色权限', async () => {
      const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
      const viewer = await viewerContext.newPage()
      viewer.on('console', msg => { if (msg.type() === 'error' && !IGNORE_CONSOLE.includes(msg.text())) consoleErrors.push(`viewer: ${msg.text()}`) })
      viewer.on('response', r => { if (r.status() >= 500) serverErrors.push(`viewer: ${r.status()} ${r.url()}`) })
      await login(viewer, 'viewer', 'BencaoDemo2026!')
      await viewer.goto(`${base}/admin/users`, { waitUntil: 'domcontentloaded' })
      await viewer.getByText('没有访问权限', { exact: true }).waitFor({ timeout: 10000 })
      await shot(viewer, 'viewer-forbidden')
      await viewerContext.close()
    })
  } finally {
    await context.close()
    await browser.close()
  }

  const report = { base, ranAt: new Date().toISOString(), steps, consoleErrors, pageErrors, serverErrors }
  writeFileSync(join(shots, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`\n[admin-smoke] ${steps.length} steps, ${consoleErrors.length} console errors, ${pageErrors.length} page errors, ${serverErrors.length} server errors`)
  if (pageErrors.length) console.log(pageErrors.join('\n'))
  if (consoleErrors.length) console.log(consoleErrors.slice(0, 10).join('\n'))
  if (serverErrors.length) console.log(serverErrors.slice(0, 10).join('\n'))
  if (pageErrors.length || consoleErrors.length || serverErrors.length) process.exitCode = 1
}

main().catch(e => { console.error(e); process.exit(1) })
