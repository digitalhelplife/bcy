#!/usr/bin/env node
// Local demo environment: three Postgres databases + deterministic fixtures + .env.admin-demo.
// Safe to re-run: it drops only the *_demo databases it owns.
// Usage: node scripts/admin-demo-setup.mjs
import { createCipheriv, createHmac, randomBytes, randomUUID, scryptSync } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'

const root = resolve(new URL('..', import.meta.url).pathname)
const superUrl = process.env.PG_SUPER_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/postgres'
const suffix = process.env.ADMIN_DEMO_SUFFIX || ''
const DB = {
  admin: `bencao_admin_demo${suffix}`,
  auth: `bencao_auth_demo${suffix}`,
  nakama: `nakama_demo${suffix}`,
}
const urlFor = name => `postgresql://postgres:postgres@127.0.0.1:5432/${name}?sslmode=disable`

/* deterministic PRNG */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20261029)
const rand = (n) => Math.floor(rng() * n)
const pick = (arr) => arr[rand(arr.length)]
const chance = (p) => rng() < p

const DAY = 86400000
const now = Date.now()
const dayKeyUtc8 = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
const today = dayKeyUtc8(now)
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const atMs = (day, hour) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+08:00`)

/* keys (demo only; generated per setup and written to .env.admin-demo) */
const keys = {
  data: Buffer.alloc(32, 7),
  pepper: Buffer.alloc(32, 11),
  ticket: Buffer.alloc(32, 13),
}
const internalSecret = 'demo-internal-secret-0123456789abcdef'
const encrypt = (plain) => {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keys.data, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}
const phoneHash = (phone) => createHmac('sha256', keys.pepper).update(`phone\u0000${phone}`).digest('hex')
const hashPassword = (pw) => {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`
}

const plantsJson = JSON.parse(readFileSync(join(root, 'content/plants.json'), 'utf8'))
const plantIds = plantsJson.plants.map(p => p.plantId)
const LEVELS = ['dujiangyan_find', 'dujiangyan_puzzle', 'qingcheng_find', 'qingcheng_puzzle', 'jiezi_find', 'jiezi_puzzle']

/* ---------------- schema ---------------- */
async function recreate(pool, name) {
  await pool.query(`drop database if exists ${name} with (force)`)
  await pool.query(`create database ${name}`)
}

async function main() {
  const superPool = new pg.Pool({ connectionString: superUrl, max: 2 })
  console.log(`[demo] recreating ${Object.values(DB).join(', ')}`)
  for (const name of Object.values(DB)) await recreate(superPool, name)
  await superPool.end()

  const admin = new pg.Pool({ connectionString: urlFor(DB.admin), max: 4 })
  const auth = new pg.Pool({ connectionString: urlFor(DB.auth), max: 4 })
  const nakama = new pg.Pool({ connectionString: urlFor(DB.nakama), max: 4 })

  await admin.query(readFileSync(join(root, 'backend/admin/sql/0001_admin.sql'), 'utf8'))

  const authTs = readFileSync(join(root, 'backend/auth/src/schema.ts'), 'utf8')
  const authSchema = authTs.match(/export const SCHEMA = `([\s\S]*?)`/)?.[1]
  if (!authSchema) throw new Error('could not extract auth schema')
  await auth.query(authSchema)
  await auth.query(readFileSync(join(root, 'backend/admin/sql/auth_views.sql'), 'utf8'))

  await nakama.query(`
    create table users (
      id uuid primary key,
      username varchar(128),
      display_name varchar(255),
      avatar_url varchar(255),
      lang_tag varchar(16),
      location varchar(255),
      timezone varchar(64),
      metadata jsonb,
      create_time timestamptz not null default now(),
      update_time timestamptz not null default now(),
      custom_id varchar(128)
    );
    create unique index users_custom_id on users (custom_id) where custom_id <> '';
    create table storage (
      collection varchar(255) not null,
      key varchar(255) not null,
      owner_id uuid not null,
      value bytea not null,
      version varchar(64) not null,
      read_permission smallint not null default 0,
      write_permission smallint not null default 0,
      create_time timestamptz not null default now(),
      update_time timestamptz not null default now(),
      primary key (collection, key, owner_id)
    );
  `)
  await nakama.query(readFileSync(join(root, 'backend/admin/sql/nakama_views.sql'), 'utf8'))

  /* ---------------- admin users ---------------- */
  const demoPassword = 'BencaoDemo2026!'
  const admins = [
    ['owner', 'owner'], ['ops', 'ops'], ['support', 'support'], ['reviewer', 'reviewer'], ['viewer', 'viewer'],
  ]
  for (const [username, role] of admins) {
    await admin.query(
      'insert into admin_users (id, username, password_hash, role, created_by) values ($1,$2,$3,$4,$5)',
      [randomUUID(), username, hashPassword(demoPassword), role, 'demo:seed']
    )
  }

  /* ---------------- game data ---------------- */
  const feedbackTexts = [
    '希望能加一个“只看不摘”的提示，孩子看到花就想摘。',
    '在都江堰找雾那关卡住了，拖了很久才过去，能不能提示更明显一点？',
    '游记导出后图片有点糊，想要高清版本。',
    '建议增加成都本地更多公园的场景。',
    '很喜欢植物知识卡，孩子会主动问这是什么花。',
    '小院摆放能不能旋转？现在只能左右移动。',
    '节气挑战的日期能不能提前提醒？',
    '手机发热有点明显，玩十分钟就烫。',
    '希望有家长模式的时间统计。',
    '反馈入口有点深，找了两分钟。',
    '拼图关卡最后一块总是对不准。',
    '能不能加背景音乐开关？现在只有音效。',
    '孩子想看更多小动物。',
    '导出到相册失败了一次，重试成功了。',
    '青城山的路线图很好看。',
    '希望增加简体/繁体切换。',
    '植物卡片里的拉丁名可以隐藏吗？孩子看不懂。',
    '秋假活动很好，希望多来几次。',
  ]
  const contacts = ['13800000001', '13800000002', 'wx_herbal_mom', 'parent@example.com', '', '', '13900000003']

  let phoneSeq = 0
  const users = []
  for (let i = 0; i < 120; i++) {
    const createdDay = addDays(today, -rand(30))
    const createdHour = 8 + rand(12)
    const createdAt = atMs(createdDay, createdHour)
    const isPhone = chance(0.55)
    const nakamaId = randomUUID()
    const authId = isPhone ? randomUUID() : null
    const progress = rng()
    const completedCount = Math.min(6, Math.floor(progress * 7))
    const completedLevels = LEVELS.slice(0, completedCount)
    const discovered = plantIds.slice(0, Math.floor(progress * plantIds.length))
    const telemetry = chance(0.65)
    const realname = !isPhone ? null : chance(0.62) ? 'VERIFIED_ADULT' : chance(0.55) ? 'VERIFIED_MINOR' : chance(0.5) ? 'PENDING' : 'UNVERIFIED'
    const phone = isPhone ? `138${String(10000000 + (phoneSeq++)).padStart(8, '0')}` : null

    users.push({ nakamaId, authId, isPhone, phone, createdDay, createdAt, progress, completedLevels, discovered, telemetry, realname, index: i })

    await nakama.query(
      `insert into users (id, username, display_name, create_time, update_time, custom_id)
       values ($1,$2,$3,to_timestamp($4/1000.0),to_timestamp($4/1000.0),$5)`,
      [nakamaId, `player_${i + 1}`, `玩家${i + 1}`, createdAt, authId ? `bcy-${authId}` : '']
    )

    if (authId) {
      await auth.query(
        `insert into auth_accounts (user_id, phone_ciphertext, phone_lookup_hash, realname_status, account_status, created_at, updated_at)
         values ($1,$2,$3,$4,'ACTIVE',to_timestamp($5/1000.0),to_timestamp($5/1000.0))`,
        [authId, encrypt(phone), phoneHash(phone), realname, createdAt]
      )
      if (realname === 'UNVERIFIED' && chance(0.12)) {
        await auth.query(
          "insert into realname_requests (ai,user_id,request_status,submitted_at,result_at) values ($1,$2,'FAILED',now() - interval '3 days',now() - interval '3 days')",
          [randomUUID(), authId]
        )
      }
      // playtime sessions for the last few active days
      for (let d = 0; d < 6; d++) {
        if (!chance(0.45)) continue
        const day = addDays(today, -d)
        const start = atMs(day, 19 + rand(3))
        const duration = (8 + rand(35)) * 60_000
        await auth.query(
          'insert into playtime_sessions (user_id, started_at, last_at, closed) values ($1,to_timestamp($2/1000.0),to_timestamp($3/1000.0),$4)',
          [authId, start, start + duration, d !== 0 || chance(0.6)]
        )
      }
    }

    const levels = {}
    for (const lv of LEVELS) {
      const done = completedLevels.includes(lv)
      levels[lv] = { firstCompletedAtMs: done ? createdAt + 3600_000 + LEVELS.indexOf(lv) * 1800_000 : null, firstRouteClaimed: { plant: done, decor: done && chance(0.6) }, decorRewardCount: done ? rand(3) : 0 }
    }
    const plots = Array.from({ length: 8 }, (_, p) => ({
      plotId: `plot_${p + 1}`,
      planting: p < Math.floor(progress * 8) ? { plantingId: randomUUID(), plantId: pick(plantIds), startedAtMs: createdAt + p * 3600_000, readyAtMs: createdAt + p * 3600_000 + 6 * 3600_000 } : null,
    }))
    const placements = Array.from({ length: Math.floor(progress * 14) }, (_, p) => ({
      placementId: `pl_${p}`, itemId: `decor_${p % 6}`, x: 100 + (p % 5) * 90, y: 300 + Math.floor(p / 5) * 80, rotation: 0,
    }))
    const state = {
      schemaVersion: 3, contentProfile: 'chengdu_v1', stateRevision: 10 + rand(90),
      createdAtMs: createdAt, tutorialStage: progress < 0.15 ? 'explore' : progress < 0.3 ? 'plant' : progress < 0.45 ? 'collect' : progress < 0.6 ? 'decorate' : 'complete',
      tutorialSkipped: chance(0.12), tutorialGrowUsed: chance(0.7), tutorialPlantingId: null,
      discoveredPlantIds: discovered,
      unlockedStoryIds: [], unlockedPaletteIds: progress > 0.3 ? ['green', 'warm_wood'] : ['green'],
      unlockedSetIds: progress > 0.6 ? ['set_spring'] : [],
      levels, inventory: Object.fromEntries(discovered.slice(0, 6).map(p => [p, 1 + rand(3)])),
      plots, garden: { paletteId: progress > 0.5 ? 'warm_wood' : 'green', placements },
      repeatRewardDayKey: today, repeatRewardUsed: rand(2), activeRunId: null,
      consent: { privacyVersion: '2026-10-v1', telemetry, updatedAtMs: createdAt },
      settings: { parentMode: chance(0.25) },
      season: { claimed: [], challenges: [] },
      observations: Object.fromEntries(discovered.slice(0, 4).map(p => [p, [createdAt]])),
      quizStamps: discovered.slice(0, Math.floor(discovered.length / 2)),
      visitors: chance(0.3) ? ['visitor_bee'] : [],
    }
    await nakama.query(
      `insert into storage (collection,key,owner_id,value,version) values ('game_player','state',$1,$2,'1')`,
      [nakamaId, Buffer.from(JSON.stringify(state))]
    )

    for (const lv of completedLevels) {
      const runId = randomUUID()
      const startedAtMs = createdAt + 3600_000 + LEVELS.indexOf(lv) * 1800_000
      const run = {
        runId, userId: nakamaId, levelId: lv, route: chance(0.5) ? 'plant' : 'decor', configVersion: 'chengdu_content_v1',
        shuffleSeed: rand(1_000_000), status: 'FINISHED', startedAtMs, expiresAtMs: startedAtMs + 15 * 60_000,
        finishedAtMs: startedAtMs + (4 + rand(8)) * 60_000,
      }
      await nakama.query(
        `insert into storage (collection,key,owner_id,value,version) values ('game_runs',$1,$2,$3,'1')`,
        [runId, nakamaId, Buffer.from(JSON.stringify(run))]
      )
    }

    if (telemetry) {
      const startOffset = Math.round((Date.parse(`${createdDay}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY)
      for (let d = startOffset; d <= 0; d++) {
        if (d !== startOffset && !chance(0.38)) continue
        const day = addDays(today, d)
        const events = [{ eventName: 'app_open', fields: {} }, { eventName: 'login_success', fields: {} }]
        if (progress > 0.25) events.push({ eventName: 'tutorial_step', fields: { stage: 'complete' } })
        for (const lv of completedLevels) if (chance(0.25)) events.push({ eventName: 'run_finish', fields: { levelId: lv, rewardMode: 'route_first' } })
        if (discovered.length) events.push({ eventName: 'plant_claim', fields: { plantId: pick(discovered) } })
        if (progress > 0.7 && chance(0.35)) events.push({ eventName: 'share_export', fields: { templateId: 'share_scenic', hasPhoto: chance(0.5) } })
        if (chance(0.2)) events.push({ eventName: 'trip_card_view', fields: { sceneId: 'dujiangyan' } })
        const at = atMs(day, 9 + rand(12))
        const value = { atMs: at, dayKey: day, events }
        await nakama.query(
          'insert into storage (collection,key,owner_id,value,version) values (\'game_telemetry\',$1,$2,$3,\'1\')',
          [randomUUID(), nakamaId, Buffer.from(JSON.stringify(value))]
        )
      }
    }
  }

  // feedback for a subset of users
  for (let i = 0; i < 18; i++) {
    const u = users[rand(users.length)]
    const at = Math.min(now - 60_000, Math.max(u.createdAt + 3600_000, now - rand(12) * DAY - rand(12) * 3600_000))
    const value = { atMs: at, text: feedbackTexts[i % feedbackTexts.length], contact: pick(contacts), clientBuild: '2.3.0', status: 'NEW' }
    await nakama.query(
      'insert into storage (collection,key,owner_id,value,version) values (\'game_feedback\',$1,$2,$3,\'1\')',
      [randomUUID(), u.nakamaId, Buffer.from(JSON.stringify(value))]
    )
  }

  /* ---------------- promo ---------------- */
  const channels = [
    [randomUUID(), 'xhs_s1', '小红书 S1', 'xiaohongshu', '内测招募'],
    [randomUUID(), 'offline_chengdu', '成都线下', 'offline', '都江堰/街子古镇物料'],
    [randomUUID(), 'xhs_kol', '博主共创', 'xiaohongshu', '共创包投放'],
  ]
  for (const [id, code, name, platform, notes] of channels) {
    await admin.query('insert into promo_channels (id,game_id,code,name,platform,notes) values ($1,\'bencaoyou\',$2,$3,$4,$5)', [id, code, name, platform, notes])
  }
  const campaigns = [
    [randomUUID(), channels[0][0], '秋假亲子打卡', addDays(today, -20), addDays(today, 10), 50000],
    [randomUUID(), channels[2][0], '博主内测招募', addDays(today, -12), addDays(today, 18), 30000],
  ]
  for (const [id, ch, name, start, end, budget] of campaigns) {
    await admin.query(
      'insert into promo_campaigns (id,game_id,channel_id,name,start_day,end_day,budget_cents,landing_url) values ($1,\'bencaoyou\',$2,$3,$4,$5,$6,$7)',
      [id, ch, name, start, end, budget, 'https://bencaoyou.tryliang.me']
    )
  }
  const links = [
    [randomUUID(), campaigns[0][0], 'xhs_s1_a', 'https://bencaoyou.tryliang.me?ch=xhs_s1&c=' + campaigns[0][0].slice(0, 8) + '&l=xhs_s1_a'],
    [randomUUID(), campaigns[0][0], 'offline_chengdu_a', 'https://bencaoyou.tryliang.me?ch=offline_chengdu&c=' + campaigns[0][0].slice(0, 8) + '&l=offline_chengdu_a'],
    [randomUUID(), campaigns[1][0], 'xhs_kol_a', 'https://bencaoyou.tryliang.me?ch=xhs_kol&c=' + campaigns[1][0].slice(0, 8) + '&l=xhs_kol_a'],
  ]
  for (const [id, camp, code, url] of links) {
    await admin.query('insert into promo_links (id,game_id,campaign_id,code,url,created_by) values ($1,\'bencaoyou\',$2,$3,$4,$5)', [id, camp, code, url, 'demo:seed'])
  }
  for (const [linkId, camp, code] of links) {
    const ch = campaigns.find(c => c[0] === camp)[1]
    for (let d = 30; d >= 0; d--) {
      const day = addDays(today, -d)
      const clicks = Math.max(0, Math.round(rng() * 14 + (d < 7 ? 4 : 0)))
      if (!clicks) continue
      await admin.query(
        'insert into promo_clicks_daily (game_id,day,channel_id,campaign_id,link_id,clicks) values (\'bencaoyou\',$1,$2,$3,$4,$5)',
        [day, ch, camp, linkId, clicks]
      )
    }
  }
  const importId = randomUUID()
  await admin.query(
    "insert into promo_imports (id,game_id,filename,file_hash,imported_by,row_count) values ($1,'bencaoyou','xhs_report_2026-10.csv','demo-hash-1','demo:seed',6)",
    [importId]
  )
  for (let d = 6; d >= 0; d--) {
    await admin.query(
      'insert into promo_report_rows (import_id,day,channel_id,campaign_id,impressions,clicks,spend_cents) values ($1,$2,$3,$4,$5,$6,$7)',
      [importId, addDays(today, -d), channels[0][0], campaigns[0][0], 12000 + rand(4000), 180 + rand(80), 3500 + rand(900)]
    )
  }

  /* ---------------- env file ---------------- */
  const envFile = join(root, '.env.admin-demo')
  const envPairs = [
    ['ADMIN_DATABASE_URL', urlFor(DB.admin)],
    ['NAKAMA_DATABASE_URL', urlFor(DB.nakama)],
    ['AUTH_DATABASE_URL', urlFor(DB.auth)],
    ['AUTH_BASE_URL', 'http://127.0.0.1:7360'],
    ['AUTH_INTERNAL_SECRET', internalSecret],
    ['AUTH_ENV', 'staging'],
    ['AUTH_DATA_KEY', keys.data.toString('base64')],
    ['AUTH_LOOKUP_PEPPER', keys.pepper.toString('base64')],
    ['AUTH_TICKET_KEY', keys.ticket.toString('base64')],
    ['AUTH_ADMIN_PASSWORD_HASH', hashPassword(demoPassword)],
    ['AUTH_PORT', '7360'],
    ['ADMIN_PORT', '7361'],
    ['ADMIN_ENV', 'staging'],
    ['ADMIN_COOKIE_SECURE', '0'],
    ['ADMIN_BOOTSTRAP_USERNAME', 'owner'],
    ['ADMIN_BOOTSTRAP_PASSWORD', demoPassword],
    ['ADMIN_ROOT', root],
    ['ADMIN_GAME_URL', 'https://bencaoyou.tryliang.me'],
  ]
  const env = envPairs.map(([k, v]) => `${k}='${String(v).replace(/'/g, `'\\''`)}'`).join('\n') + '\n'
  writeFileSync(envFile, env, { mode: 0o600 })

  await Promise.all([admin.end(), auth.end(), nakama.end()])
  console.log(`[demo] ready`)
  console.log(`  admin login: owner / ${demoPassword} (also ops/support/reviewer/viewer)`)
  console.log(`  env file: ${envFile}`)
  console.log(`  next: set -a; source .env.admin-demo; set +a; node backend/admin/build/bencao-admin.mjs`)
}

main().catch(e => { console.error(e); process.exit(1) })
