import react from '@vitejs/plugin-react'
import { manusGameTuning } from './scripts/manus-tuning/vite.mjs'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Relative base keeps production output portable; the Session owns preview HOST/PORT.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['HOST', 'PORT'])
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  return {
    define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
    base: './',
    plugins: [react(), manusGameTuning()],
    // Local-only: `SMOKE_LIVE_API=1 vite preview` serves dist locally but forwards /auth to the live server, so the smoke
    // test can exercise the real backend without depending on a slow link for multi-MB images. No effect on builds.
    preview: process.env.SMOKE_LIVE_API === '1' ? { proxy: { '/auth': { target: 'https://ex-game.tryliang.me', changeOrigin: true, secure: true } } } : undefined,
    server: {
      host: env.HOST ?? '127.0.0.1', port, strictPort: true,
      allowedHosts: ['.manuspre.computer', '.manus.computer', '.manus-asia.computer', '.manuscomputer.ai', '.manusvm.computer', 'localhost', '127.0.0.1'],
    },
    build: {
      target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 4600, sourcemap: false,
      // A5 G11: Phaser is reached only through the lazy canvas screens; give its chunk a clear name.
      rollupOptions: { output: { manualChunks: (id: string) => (id.includes('/node_modules/phaser/') ? 'phaser' : undefined) } },
    },
    test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'] },
  }
})
