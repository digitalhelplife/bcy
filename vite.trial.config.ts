// A6-A1a: standalone offline trial build → dist-trial/ (scripts/build-trial.mjs copies the needed assets and zips it).
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
export default defineConfig({
  base: './',
  plugins: [react()],
  publicDir: false,
  define: { __BUILD_ID__: JSON.stringify('trial') },
  build: { outDir: 'dist-trial', emptyOutDir: true, rollupOptions: { input: resolve(__dirname, 'trial.html') } },
})
