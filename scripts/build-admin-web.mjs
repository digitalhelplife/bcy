#!/usr/bin/env node
// Build the admin SPA and normalize the entry file to dist-admin/index.html.
import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(new URL('..', import.meta.url).pathname)
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.admin.config.ts'], {
  cwd: root, stdio: 'inherit',
})
const out = join(root, 'dist-admin')
const built = join(out, 'admin.html')
const index = join(out, 'index.html')
if (existsSync(built)) {
  if (existsSync(index)) copyFileSync(built, index)
  else renameSync(built, index)
}
console.log('[admin-web] dist-admin/index.html ready')
