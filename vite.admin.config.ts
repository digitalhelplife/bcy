import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: 'dist-admin',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: resolve(process.cwd(), 'admin.html') },
  },
  server: {
    port: 4174,
    strictPort: true,
    proxy: { '/admin/api': 'http://127.0.0.1:7361', '/admin/media': 'http://127.0.0.1:7361' },
  },
})
