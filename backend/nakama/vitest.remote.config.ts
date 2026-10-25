import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['backend/nakama/contract.remote.ts'], testTimeout: 90000, hookTimeout: 120000, environment: 'node' } })
