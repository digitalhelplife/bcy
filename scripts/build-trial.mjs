// A6-A1a: build the offline trial → dist-trial/ + release/本草小游记-都江堰离线试玩.zip
// Copies only the images listed in src/trial/assetList.ts plus fonts, then checks no network endpoint is referenced.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

const root = new URL('..', import.meta.url).pathname
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
run('npx', ['vite', 'build', '--config', 'vite.trial.config.ts'], { VITE_RELEASE_STAGE: process.env.VITE_RELEASE_STAGE || 'S0' })

const tmp = join(root, '.trial-tmp'); mkdirSync(tmp, { recursive: true })
await build({ entryPoints: [join(root, 'src/trial/assetList.ts')], bundle: true, platform: 'node', format: 'esm', outfile: join(tmp, 'list.mjs'), loader: { '.json': 'json' }, logLevel: 'silent' })
const { TRIAL_ASSETS } = await import(join(tmp, 'list.mjs'))
rmSync(tmp, { recursive: true, force: true })
const out = join(root, 'dist-trial')
for (const p of new Set(TRIAL_ASSETS)) {
  const src = join(root, 'public/assets', `${p}.webp`)
  if (!existsSync(src)) throw new Error(`missing trial asset ${p}`)
  mkdirSync(dirname(join(out, 'assets', `${p}.webp`)), { recursive: true }); cpSync(src, join(out, 'assets', `${p}.webp`))
}
cpSync(join(root, 'public/favicon.ico'), join(out, 'favicon.ico'))
if (existsSync(join(root, 'public/fonts'))) cpSync(join(root, 'public/fonts'), join(out, 'fonts'), { recursive: true })

// Guard: the trial must not talk to any server.
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p] })
const js = walk(out).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')
for (const bad of ['tryliang.me', '/v2/rpc', '/auth/sms', 'nakama']) if (js.includes(bad)) throw new Error(`trial bundle references ${bad}`)
writeFileSync(join(out, 'README.txt'), [
  '本草小游记·成都篇 — 都江堰离线试玩包',
  '入口：trial.html。纯静态文件，不登录、不联网、不保存记录；游记图片只在本机生成。',
  '游戏画面·成都主题原创改编 · 非景区官方产品。投放前请按《附录 A7》逐项核实平台规则。', '',
].join('\n'))
mkdirSync(join(root, 'release'), { recursive: true })
const zip = join(root, 'release', '本草小游记-都江堰离线试玩.zip')
rmSync(zip, { force: true })
execFileSync('zip', ['-qr', zip, '.'], { cwd: out, stdio: 'inherit' })
const kb = Math.round(statSync(zip).size / 1024)
console.log(`[trial] ${zip} (${kb} KiB, ${walk(out).length} files)`)
