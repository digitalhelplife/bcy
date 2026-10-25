// Bundle bencao-auth into one Node 22 ESM file (pg is bundled; pg-native is optional and excluded).
import { build } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
await build({
  entryPoints: [resolve(here, 'src/entry.ts')], bundle: true, platform: 'node', target: 'node22', format: 'esm',
  outfile: resolve(here, 'build/bencao-auth.mjs'), external: ['pg-native'], legalComments: 'none',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
console.log('wrote backend/auth/build/bencao-auth.mjs')
