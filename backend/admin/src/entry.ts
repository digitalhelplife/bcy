import { main } from './main'

main().catch(e => {
  console.error('[admin] fatal:', e?.stack || e)
  process.exit(1)
})
