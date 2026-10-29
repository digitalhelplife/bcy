// Read-only adapters for the Nakama and bencao-auth databases.
// The design joins the two stores in application code; no cross-database SQL is used.
import pg from 'pg'

export type NakamaUser = {
  id: string
  customId: string
  username: string | null
  createTimeMs: number
  updateTimeMs: number
}

export type PlayerSummary = {
  stateRevision: number
  tutorialStage: string
  tutorialSkipped: boolean
  plantsDiscovered: number
  plantsOwned: number
  gardenPlacements: number
  levelsCompleted: number
  completedLevels: string[]
  dujiangyanCompleted: boolean
  seasonClaims: number
  observations: number
  quizStamps: number
  parentMode: boolean
  telemetryConsent: boolean
  updatedAtMs: number
}

export type AuthAccount = {
  userId: string
  realnameStatus: string
  accountStatus: string
  createdAtMs: number
  updatedAtMs: number
  deletedAtMs: number | null
}

export type FeedbackRow = {
  ownerId: string
  key: string
  atMs: number
  text: string
  contact: string
  clientBuild: string | null
  storedStatus: string
  updatedAtMs: number
}

export type PlaytimeSession = { startedAtMs: number; lastAtMs: number; closed: boolean }

const DAY = 86400000
export const dayKeyUtc8 = (ms: number) => {
  const d = new Date(ms + 8 * 3600_000)
  return d.toISOString().slice(0, 10)
}
const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0)
const dayOf = (d: Date | string | null | undefined) => {
  if (!d) return ''
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
}
const asJson = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as any

export class NakamaReader {
  constructor(readonly pool: pg.Pool) {}

  async ping(): Promise<boolean> {
    try { await this.pool.query('select 1 from admin_v_users limit 1'); return true } catch { return false }
  }

  async countUsers(): Promise<number> {
    return Number((await this.pool.query('select count(*)::int n from admin_v_users')).rows[0].n)
  }

  /** Pre-resolve auth user ids into Nakama ids for filters that live in the auth DB. */
  async nakamaIdsForAuthUserIds(authIds: string[]): Promise<string[]> {
    if (!authIds.length) return []
    const custom = authIds.map(id => `bcy-${id}`)
    const r = await this.pool.query('select id::text id from admin_v_users where custom_id = any($1)', [custom])
    return r.rows.map(x => x.id)
  }

  async usersPage(f: {
    q?: string; login?: string; realname?: string; status?: string
    from?: string; to?: string; activeFrom?: string; activeTo?: string; feedback?: boolean
    restrictIds?: string[] | null
    page: number; pageSize: number
  }): Promise<{ total: number; rows: NakamaUser[] }> {
    const where: string[] = []
    const vals: unknown[] = []
    if (f.q) {
      vals.push(f.q)
      const n = vals.length
      where.push(`(id::text = $${n} or custom_id = $${n} or coalesce(username,'') ilike '%'||$${n}||'%' or custom_id = 'bcy-'||$${n})`)
    }
    if (f.login === 'device') where.push(`custom_id not like 'bcy-%'`)
    if (f.login === 'phone') where.push(`custom_id like 'bcy-%'`)
    if (f.from) { vals.push(f.from); where.push(`create_time >= $${vals.length}::date`) }
    if (f.to) { vals.push(f.to); where.push(`create_time < ($${vals.length}::date + interval '1 day')`) }
    if (f.activeFrom) { vals.push(f.activeFrom); where.push(`exists (select 1 from admin_v_player_state ps where ps.owner_id = admin_v_users.id::text and ps.update_time >= $${vals.length}::date)`) }
    if (f.activeTo) { vals.push(f.activeTo); where.push(`exists (select 1 from admin_v_player_state ps where ps.owner_id = admin_v_users.id::text and ps.update_time < ($${vals.length}::date + interval '1 day'))`) }
    if (f.restrictIds) {
      if (!f.restrictIds.length) return { total: 0, rows: [] }
      vals.push(f.restrictIds); where.push(`id::text = any($${vals.length})`)
    }
    if (f.feedback) {
      where.push(`exists (select 1 from admin_v_storage_feedback fb where fb.owner_id = admin_v_users.id::text)`)
    }
    const w = where.length ? `where ${where.join(' and ')}` : ''
    const total = Number((await this.pool.query(`select count(*)::int n from admin_v_users ${w}`, vals)).rows[0].n)
    const rows = (await this.pool.query(
      `select id::text id, coalesce(custom_id,'') custom_id, username, create_time, update_time
       from admin_v_users ${w} order by create_time desc limit $${vals.length + 1} offset $${vals.length + 2}`,
      [...vals, f.pageSize, (f.page - 1) * f.pageSize]
    )).rows.map(mapUser)
    return { total, rows }
  }

  async usersByIds(ids: string[]): Promise<NakamaUser[]> {
    if (!ids.length) return []
    return (await this.pool.query(
      'select id::text id, coalesce(custom_id,\'\') custom_id, username, create_time, update_time from admin_v_users where id::text = any($1)', [ids]
    )).rows.map(mapUser)
  }

  async userById(id: string): Promise<NakamaUser | null> {
    const r = await this.pool.query(
      'select id::text id, coalesce(custom_id,\'\') custom_id, username, create_time, update_time from admin_v_users where id::text=$1 or custom_id=$1 or custom_id=$2 limit 1',
      [id, id.startsWith('bcy-') ? id : `bcy-${id}`]
    )
    return r.rows[0] ? mapUser(r.rows[0]) : null
  }

  /** Latest save state per user (storage CAS keeps the newest version). */
  async playerStates(ownerIds: string[]): Promise<Map<string, { summary: PlayerSummary; raw: any }>> {
    const out = new Map<string, { summary: PlayerSummary; raw: any }>()
    if (!ownerIds.length) return out
    const r = await this.pool.query(
      `select distinct on (owner_id) owner_id, value, update_time from admin_v_player_state
       where owner_id = any($1) order by owner_id, update_time desc`, [ownerIds]
    )
    for (const row of r.rows) {
      const raw = asJson(row.value)
      out.set(row.owner_id, { summary: summarize(raw, ms(row.update_time)), raw })
    }
    return out
  }

  async allPlayerStates(): Promise<Array<{ ownerId: string; summary: PlayerSummary }>> {
    const r = await this.pool.query(
      `select distinct on (owner_id) owner_id, value, update_time from admin_v_player_state order by owner_id, update_time desc`
    )
    return r.rows.map(row => ({ ownerId: row.owner_id, summary: summarize(asJson(row.value), ms(row.update_time)) }))
  }

  async feedbackForOwners(ownerIds: string[]): Promise<FeedbackRow[]> {
    if (!ownerIds.length) return []
    return (await this.pool.query(
      `select owner_id, key, value, update_time from admin_v_storage_feedback where owner_id = any($1) order by update_time desc`, [ownerIds]
    )).rows.map(mapFeedback)
  }

  async allFeedback(limit = 5000): Promise<FeedbackRow[]> {
    return (await this.pool.query(
      `select owner_id, key, value, update_time from admin_v_storage_feedback order by update_time desc limit $1`, [limit]
    )).rows.map(mapFeedback)
  }

  async feedbackDetail(ownerId: string, key: string): Promise<FeedbackRow | null> {
    const r = await this.pool.query('select owner_id, key, value, update_time from admin_v_storage_feedback where owner_id=$1 and key=$2', [ownerId, key])
    return r.rows[0] ? mapFeedback(r.rows[0]) : null
  }

  async feedbackCountsByOwner(ownerIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (!ownerIds.length) return out
    const r = await this.pool.query(
      'select owner_id, count(*)::int n from admin_v_storage_feedback where owner_id = any($1) group by owner_id', [ownerIds]
    )
    for (const x of r.rows) out.set(x.owner_id, Number(x.n))
    return out
  }

  async runsForOwner(ownerId: string, limit = 20) {
    return (await this.pool.query(
      `select key, value, update_time from admin_v_runs where owner_id=$1 order by update_time desc limit $2`, [ownerId, limit]
    )).rows.map(r => ({ key: r.key, value: asJson(r.value), updateTimeMs: ms(r.update_time) }))
  }

  /* ---------------- telemetry aggregates ---------------- */
  async activeUsersByDay(fromDay: string, toDay: string): Promise<Array<{ day: string; users: number }>> {
    const r = await this.pool.query(
      `select (t.value->>'dayKey') as day_key, count(distinct t.owner_id)::int users
       from admin_v_storage_telemetry t
       cross join lateral jsonb_array_elements(t.value->'events') e
       where (e->>'eventName') in ('app_open','login_success') and (t.value->>'dayKey') between $1 and $2
       group by 1 order by 1`, [fromDay, toDay]
    )
    return r.rows.map(x => ({ day: dayOf(x.day_key), users: Number(x.users) }))
  }

  async eventUsers(fromDay: string, toDay: string): Promise<Map<string, number>> {
    const r = await this.pool.query(
      `select (e->>'eventName') name, count(distinct t.owner_id)::int users
       from admin_v_storage_telemetry t
       cross join lateral jsonb_array_elements(t.value->'events') e
       where (t.value->>'dayKey') between $1 and $2
       group by 1`, [fromDay, toDay]
    )
    const out = new Map<string, number>()
    for (const x of r.rows) out.set(x.name, Number(x.users))
    return out
  }

  async firstSeenByUser(): Promise<Map<string, string>> {
    const r = await this.pool.query(
      `select owner_id, min(t.value->>'dayKey') as day_key from admin_v_storage_telemetry t
       cross join lateral jsonb_array_elements(t.value->'events') e
       where (e->>'eventName') in ('app_open','login_success') group by 1`
    )
    const out = new Map<string, string>()
    for (const x of r.rows) if (x.day_key) out.set(x.owner_id, dayOf(x.day_key))
    return out
  }

  async activeUserIdsOn(day: string): Promise<Set<string>> {
    const r = await this.pool.query(
      `select distinct t.owner_id from admin_v_storage_telemetry t
       cross join lateral jsonb_array_elements(t.value->'events') e
       where (e->>'eventName') in ('app_open','login_success') and (t.value->>'dayKey')=$1`, [day]
    )
    return new Set(r.rows.map(x => x.owner_id))
  }

  async usersWhoFinishedLevels(levelIds: string[], fromDay?: string, toDay?: string): Promise<number> {
    const vals: unknown[] = [levelIds]
    let dayFilter = ''
    if (fromDay) { vals.push(fromDay); dayFilter += ` and (t.value->>'dayKey') >= $${vals.length}` }
    if (toDay) { vals.push(toDay); dayFilter += ` and (t.value->>'dayKey') <= $${vals.length}` }
    const r = await this.pool.query(
      `select count(distinct owner_id)::int n from (
         select t.owner_id, count(distinct e->'fields'->>'levelId') levels
         from admin_v_storage_telemetry t cross join lateral jsonb_array_elements(t.value->'events') e
         where (e->>'eventName')='run_finish' and (e->'fields'->>'levelId') = any($1) ${dayFilter}
         group by 1
       ) x where levels = cardinality($1::text[])`, [levelIds]
    )
    return Number(r.rows[0]?.n ?? 0)
  }

  async telemetryRowCount(): Promise<number> {
    return Number((await this.pool.query('select count(*)::int n from admin_v_storage_telemetry')).rows[0].n)
  }

  async newUsersByDay(fromDay: string, toDay: string): Promise<Array<{ day: string; users: number }>> {
    const r = await this.pool.query(
      `select (create_time at time zone 'Asia/Shanghai')::date as day_key, count(*)::int users
       from admin_v_users where create_time >= $1::date and create_time < ($2::date + interval '1 day')
       group by 1 order by 1`, [fromDay, toDay]
    )
    return r.rows.map(x => ({ day: dayOf(x.day_key), users: Number(x.users) }))
  }

  async feedbackByDay(fromDay: string, toDay: string): Promise<Array<{ day: string; rows: number }>> {
    const r = await this.pool.query(
      `select (update_time at time zone 'Asia/Shanghai')::date as day_key, count(*)::int rows
       from admin_v_storage_feedback where update_time >= $1::date and update_time < ($2::date + interval '1 day')
       group by 1 order by 1`, [fromDay, toDay]
    )
    return r.rows.map(x => ({ day: dayOf(x.day_key), rows: Number(x.rows) }))
  }

  async exportUsersByDay(fromDay: string, toDay: string): Promise<Array<{ day: string; users: number }>> {
    const r = await this.pool.query(
      `select (t.value->>'dayKey') as day_key, count(distinct t.owner_id)::int users
       from admin_v_storage_telemetry t cross join lateral jsonb_array_elements(t.value->'events') e
       where (e->>'eventName')='share_export' and (t.value->>'dayKey') between $1 and $2
       group by 1 order by 1`, [fromDay, toDay]
    )
    return r.rows.map(x => ({ day: dayOf(x.day_key), users: Number(x.users) }))
  }

  async userIdsCreated(fromDay: string, toDay: string, limit = 5000): Promise<string[]> {
    const r = await this.pool.query(
      `select id::text id from admin_v_users
       where create_time >= $1::date and create_time < ($2::date + interval '1 day')
       order by create_time desc limit $3`, [fromDay, toDay, limit]
    )
    return r.rows.map(x => x.id)
  }

  async eventUserIds(eventName: string, fromDay: string, toDay: string): Promise<Set<string>> {
    const r = await this.pool.query(
      `select distinct t.owner_id from admin_v_storage_telemetry t
       cross join lateral jsonb_array_elements(t.value->'events') e
       where (e->>'eventName')=$1 and (t.value->>'dayKey') between $2 and $3`, [eventName, fromDay, toDay]
    )
    return new Set(r.rows.map(x => x.owner_id))
  }
}

export class AuthReader {
  constructor(readonly pool: pg.Pool) {}

  async ping(): Promise<boolean> {
    try { await this.pool.query('select 1 from admin_v_accounts limit 1'); return true } catch { return false }
  }

  async accountsByAuthIds(ids: string[]): Promise<Map<string, AuthAccount>> {
    const out = new Map<string, AuthAccount>()
    if (!ids.length) return out
    const r = await this.pool.query(
      `select user_id, realname_status, account_status, created_at, updated_at, deleted_at
       from admin_v_accounts where user_id = any($1)`, [ids]
    )
    for (const x of r.rows) out.set(x.user_id, mapAccount(x))
    return out
  }

  async accountByAuthId(id: string): Promise<AuthAccount | null> {
    const r = await this.pool.query('select user_id, realname_status, account_status, created_at, updated_at, deleted_at from admin_v_accounts where user_id=$1', [id])
    return r.rows[0] ? mapAccount(r.rows[0]) : null
  }

  async authIdsByRealname(status: string): Promise<string[]> {
    const r = await this.pool.query('select user_id from admin_v_accounts where realname_status=$1', [status])
    return r.rows.map(x => x.user_id)
  }

  async authIdsByAccountStatus(status: string): Promise<string[]> {
    const r = await this.pool.query('select user_id from admin_v_accounts where account_status=$1', [status])
    return r.rows.map(x => x.user_id)
  }

  async playtimeLast7d(authIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>()
    if (!authIds.length) return out
    const r = await this.pool.query(
      `select user_id, coalesce(sum(extract(epoch from (last_at - started_at))) / 60, 0)::int minutes
       from admin_v_playtime where user_id = any($1) and last_at > now() - interval '7 days' group by 1`, [authIds]
    )
    for (const x of r.rows) out.set(x.user_id, Number(x.minutes))
    return out
  }

  async sessionsForUser(authUserId: string, limit = 50): Promise<PlaytimeSession[]> {
    return (await this.pool.query(
      'select started_at, last_at, closed from admin_v_playtime where user_id=$1 order by last_at desc limit $2', [authUserId, limit]
    )).rows.map(x => ({ startedAtMs: ms(x.started_at), lastAtMs: ms(x.last_at), closed: x.closed }))
  }

  async onlineCount(): Promise<number> {
    return Number((await this.pool.query("select count(distinct user_id)::int n from admin_v_playtime where not closed and last_at > now() - interval '90 seconds'")).rows[0].n)
  }

  async realnameCounts(): Promise<Record<string, number>> {
    const r = await this.pool.query("select realname_status s, count(*)::int n from admin_v_accounts where account_status='ACTIVE' group by 1")
    const out: Record<string, number> = { UNVERIFIED: 0, PENDING: 0, VERIFIED_ADULT: 0, VERIFIED_MINOR: 0 }
    for (const x of r.rows) out[x.s] = Number(x.n)
    return out
  }

  async failedRealnameRequests(): Promise<number> {
    return Number((await this.pool.query("select count(*)::int n from admin_v_realname_requests where request_status='FAILED'")).rows[0].n)
  }

  async deletionsForUser(authUserId: string) {
    return (await this.pool.query('select request_id, completed_at from admin_v_deletions where user_id=$1 order by completed_at desc limit 10', [authUserId])).rows.map(x => ({
      requestId: x.request_id, completedAtMs: ms(x.completed_at),
    }))
  }
}

export function summarize(raw: any, updatedAtMs: number): PlayerSummary {
  const levels = raw?.levels ?? {}
  const levelIds = Object.keys(levels)
  const completed = (id: string) => levels?.[id]?.firstCompletedAtMs != null
  const discovered = Array.isArray(raw?.discoveredPlantIds) ? raw.discoveredPlantIds.length : 0
  const inventory = raw?.inventory ?? {}
  const owned = Object.values(inventory).reduce((a: number, b: any) => a + (Number(b) || 0), 0)
  const placements = Array.isArray(raw?.garden?.placements) ? raw.garden.placements.length : 0
  return {
    stateRevision: Number(raw?.stateRevision ?? 0),
    tutorialStage: String(raw?.tutorialStage ?? 'unknown'),
    tutorialSkipped: !!raw?.tutorialSkipped,
    plantsDiscovered: discovered,
    plantsOwned: owned,
    gardenPlacements: placements,
    levelsCompleted: levelIds.filter(completed).length,
    completedLevels: levelIds.filter(completed),
    dujiangyanCompleted: completed('dujiangyan_find') && completed('dujiangyan_puzzle'),
    seasonClaims: Array.isArray(raw?.season?.claimed) ? raw.season.claimed.length : 0,
    observations: raw?.observations && typeof raw.observations === 'object' ? Object.keys(raw.observations).length : 0,
    quizStamps: Array.isArray(raw?.quizStamps) ? raw.quizStamps.length : 0,
    parentMode: !!raw?.settings?.parentMode,
    telemetryConsent: raw?.consent?.telemetry === true,
    updatedAtMs,
  }
}

function mapUser(r: Record<string, any>): NakamaUser {
  return { id: r.id, customId: r.custom_id ?? '', username: r.username, createTimeMs: ms(r.create_time), updateTimeMs: ms(r.update_time) }
}
function mapFeedback(r: Record<string, any>): FeedbackRow {
  const v = asJson(r.value)
  return {
    ownerId: r.owner_id, key: r.key, atMs: Number(v?.atMs ?? ms(r.update_time)), text: String(v?.text ?? ''),
    contact: String(v?.contact ?? ''), clientBuild: v?.clientBuild ?? null, storedStatus: String(v?.status ?? 'NEW'),
    updatedAtMs: ms(r.update_time),
  }
}
function mapAccount(r: Record<string, any>): AuthAccount {
  return {
    userId: r.user_id, realnameStatus: r.realname_status, accountStatus: r.account_status,
    createdAtMs: ms(r.created_at), updatedAtMs: ms(r.updated_at), deletedAtMs: r.deleted_at ? ms(r.deleted_at) : null,
  }
}

export const DAY_MS = DAY
