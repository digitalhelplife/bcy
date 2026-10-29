import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('./autotest-driver.js', import.meta.url), 'utf8')
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push('pageerror: ' + e.message))
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
await page.goto('https://bencaoyou.tryliang.me/', { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.evaluate(src)
let report = null
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(2000)
  report = await page.evaluate(() => window.__autotestReport || null)
  if (report && report.done) break
}
if (report) console.log(report.steps.map(s => `${s.ok ? 'PASS' : 'FAIL'} ${s.name}${s.detail != null ? ' — ' + s.detail : ''}`).join('\n'))
console.log(JSON.stringify(report && { done: report.done, ok: report.ok, errors: report.errors, final: report.final }, null, 2))
console.log('ERRORS', JSON.stringify(errors.slice(0, 10)))
await browser.close()
process.exit(report && report.ok ? 0 : 1)
