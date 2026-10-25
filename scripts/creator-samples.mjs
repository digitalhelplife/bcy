import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const b = await chromium.launch({ executablePath: '/usr/bin/chromium' })
const p = await b.newPage()
await p.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded' })
const out = await p.evaluate(async () => {
  const m = await import('/src/share/exportShare.ts')
  const garden = { paletteId: 'warm_wood', placements: [
    { instanceId: 'a', itemId: 'decor_bench', x: 1, y: 1 }, { instanceId: 'b', itemId: 'decor_flowerpot', x: 5, y: 1 },
    { instanceId: 'c', itemId: 'plant_mint', x: 0, y: 9 }, { instanceId: 'd', itemId: 'plant_lotus', x: 2, y: 9 },
    { instanceId: 'e', itemId: 'plant_chrysanthemum', x: 4, y: 9 }, { instanceId: 'f', itemId: 'plant_perilla', x: 6, y: 9 },
    { instanceId: 'g', itemId: 'plant_mugwort', x: 0, y: 7 }, { instanceId: 'h', itemId: 'plant_honeysuckle', x: 7, y: 7 } ] }
  const jobs = [
    ['游记样张-景点.png', { templateId: 'share_scenic', title: '带娃看都江堰的鱼嘴分水', sceneId: 'dujiangyan', stickers: ['mint', 'lotus'] }],
    ['游记样张-植物.png', { templateId: 'share_plant', title: '今天认识了荷花', plantId: 'lotus', stickers: ['chrysanthemum'] }],
    ['游记样张-小院.png', { templateId: 'share_garden', title: '我的川西小院', garden, stickers: ['mint', 'perilla', 'honeysuckle'] }],
    ['游记样张-自然笔记.png', { templateId: 'share_nature', title: '薄荷的四次观察', plantId: 'mint', observations: [0, 1, 2, 3] }],
  ]
  const r = {}
  for (const [name, input] of jobs) { const c = await m.renderShare(input); r[name] = c.toDataURL('image/png') }
  return r
})
for (const [n, d] of Object.entries(out)) writeFileSync('/tmp/pack-samples/' + n, Buffer.from(d.split(',')[1], 'base64'))
console.log(Object.keys(out))
await b.close()
