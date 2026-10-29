// Console-owned Postgres store. Every statement is parameterized; sort/filter columns are whitelisted by callers.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { AdminRole, FeedbackStatus } from '../../../src/shared/adminContract'

export type AdminUserRow = {
  id: string
  username: string
  passwordHash: string
  role: AdminRole
  status: 'ACTIVE' | 'DISABLED'
  totpSecret: string | null
  totpEnabled: boolean
  createdAtMs: number
  createdBy: string | null
  lastLoginAtMs: number | null
}

export type SessionRow = {
  id: string
  userId: string
  username: string
  role: AdminRole
  totpEnabled: boolean
  createdAtMs: number
  lastSeenAtMs: number
  expiresAtMs: number
  ipHash: string | null
  userAgentHash: string | null
}

export type AuditEntry = {
  actorId?: string | null
  actorName?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  outcome: string
  ipHash?: string | null
  metadata?: Record<string, unknown> | null
}

export type FeedbackStateRow = {
  ownerId: string
  storageKey: string
  status: FeedbackStatus
  assigneeId: string | null
  assigneeName?: string | null
  note: string | null
  updatedAtMs: number
}

export type PromoChannel = { id: string; code: string; name: string; platform: string | null; status: string; notes: string | null; createdAtMs: number }
export type PromoCampaign = {
  id: string; channelId: string; channelCode?: string; channelName?: string; name: string
  startDay: string | null; endDay: string | null; budgetCents: number | null; landingUrl: string | null
  notes: string | null; status: string; createdAtMs: number
}
export type PromoLink = {
  id: string; campaignId: string; campaignName?: string; channelCode?: string; code: string; url: string
  createdBy: string | null; createdAtMs: number
}

const dayOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
const ms = (d: Date | null | undefined) => (d ? d.getTime() : null)

export class Store {
  constructor(readonly pool: pg.Pool) {}

  async ping(): Promise<boolean> {
    try { await this.pool.query('select 1'); return true } catch { return false }
  }

  /* ---------------- admins ---------------- */
  async countAdmins(): Promise<number> {
    return Number((await this.pool.query('select count(*)::int n from admin_users')).rows[0].n)
  }

  async countActiveOwners(): Promise<number> {
    return Number((await this.pool.query("select count(*)::int n from admin_users where role='owner' and status='ACTIVE'")).rows[0].n)
  }

  async getGame(id: string): Promise<{ id: string; name: string; stage: string; timezone: string } | null> {
    const r = await this.pool.query('select id, name, stage, timezone from games where id=$1', [id])
    return r.rows[0] ? { id: r.rows[0].id, name: r.rows[0].name, stage: r.rows[0].stage, timezone: r.rows[0].timezone } : null
  }

  async findAdminByUsername(username: string): Promise<AdminUserRow | null> {
    const r = await this.pool.query('select * from admin_users where lower(username)=lower($1) limit 1', [username])
    return r.rows[0] ? mapAdmin(r.rows[0]) : null
  }

  async findAdminById(id: string): Promise<AdminUserRow | null> {
    const r = await this.pool.query('select * from admin_users where id=$1', [id])
    return r.rows[0] ? mapAdmin(r.rows[0]) : null
  }

  async listAdmins(): Promise<AdminUserRow[]> {
    return (await this.pool.query('select * from admin_users order by created_at asc')).rows.map(mapAdmin)
  }

  async createAdmin(input: { username: string; passwordHash: string; role: AdminRole; createdBy?: string | null }): Promise<AdminUserRow> {
    const r = await this.pool.query(
      'insert into admin_users (id, username, password_hash, role, created_by) values ($1,$2,$3,$4,$5) returning *',
      [randomUUID(), input.username, input.passwordHash, input.role, input.createdBy ?? null]
    )
    return mapAdmin(r.rows[0])
  }

  async updateAdmin(id: string, patch: { role?: AdminRole; status?: 'ACTIVE' | 'DISABLED' }): Promise<AdminUserRow | null> {
    const sets: string[] = []
    const vals: unknown[] = []
    if (patch.role) { vals.push(patch.role); sets.push(`role=$${vals.length}`) }
    if (patch.status) { vals.push(patch.status); sets.push(`status=$${vals.length}`) }
    if (!sets.length) return this.findAdminById(id)
    vals.push(id)
    const r = await this.pool.query(`update admin_users set ${sets.join(',')} where id=$${vals.length} returning *`, vals)
    return r.rows[0] ? mapAdmin(r.rows[0]) : null
  }

  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('update admin_users set password_hash=$2 where id=$1', [id, passwordHash])
  }

  async setTotp(id: string, secret: string | null, enabled: boolean): Promise<void> {
    await this.pool.query('update admin_users set totp_secret=$2, totp_enabled=$3 where id=$1', [id, secret, enabled])
  }

  async markLogin(id: string): Promise<void> {
    await this.pool.query('update admin_users set last_login_at=now() where id=$1', [id])
  }

  /* ---------------- sessions ---------------- */
  async createSession(input: { userId: string; tokenHash: string; expiresAt: Date; ipHash: string | null; userAgentHash: string | null }): Promise<string> {
    const id = randomUUID()
    await this.pool.query(
      'insert into admin_sessions (id,user_id,token_hash,expires_at,ip_hash,user_agent_hash) values ($1,$2,$3,$4,$5,$6)',
      [id, input.userId, input.tokenHash, input.expiresAt, input.ipHash, input.userAgentHash]
    )
    return id
  }

  async findSession(tokenHash: string): Promise<SessionRow | null> {
    const r = await this.pool.query(
      `select s.*, u.username, u.role, u.totp_enabled, u.status
       from admin_sessions s join admin_users u on u.id=s.user_id
       where s.token_hash=$1 and s.revoked_at is null and s.expires_at > now() and u.status='ACTIVE' limit 1`,
      [tokenHash]
    )
    return r.rows[0] ? mapSession(r.rows[0]) : null
  }

  async touchSession(id: string): Promise<void> {
    await this.pool.query('update admin_sessions set last_seen_at=now() where id=$1', [id])
  }

  async revokeSession(id: string, userId?: string): Promise<boolean> {
    const r = userId
      ? await this.pool.query('update admin_sessions set revoked_at=now() where id=$1 and user_id=$2 and revoked_at is null', [id, userId])
      : await this.pool.query('update admin_sessions set revoked_at=now() where id=$1 and revoked_at is null', [id])
    return (r.rowCount ?? 0) > 0
  }

  async revokeAllSessions(userId: string, exceptId?: string): Promise<number> {
    const r = exceptId
      ? await this.pool.query('update admin_sessions set revoked_at=now() where user_id=$1 and id<>$2 and revoked_at is null', [userId, exceptId])
      : await this.pool.query('update admin_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [userId])
    return r.rowCount ?? 0
  }

  async listSessions(userId: string): Promise<SessionRow[]> {
    const r = await this.pool.query(
      `select s.*, u.username, u.role, u.totp_enabled from admin_sessions s join admin_users u on u.id=s.user_id
       where s.user_id=$1 and s.revoked_at is null and s.expires_at > now() order by s.last_seen_at desc limit 50`, [userId]
    )
    return r.rows.map(mapSession)
  }

  /* ---------------- audit ---------------- */
  async audit(e: AuditEntry): Promise<void> {
    await this.pool.query(
      'insert into admin_audit (actor_id,actor_name,action,target_type,target_id,outcome,ip_hash,metadata_redacted) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [e.actorId ?? null, e.actorName ?? null, e.action, e.targetType ?? null, e.targetId ?? null, e.outcome, e.ipHash ?? null, e.metadata ? JSON.stringify(e.metadata) : null]
    ).catch(() => undefined)
  }

  async queryAudit(f: { actor?: string; action?: string; outcome?: string; targetId?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
    const where: string[] = []
    const vals: unknown[] = []
    if (f.actor) { vals.push(`%${f.actor}%`); where.push(`coalesce(actor_name,'') ilike $${vals.length}`) }
    if (f.action) { vals.push(`%${f.action}%`); where.push(`action ilike $${vals.length}`) }
    if (f.outcome) { vals.push(f.outcome); where.push(`outcome=$${vals.length}`) }
    if (f.targetId) { vals.push(f.targetId); where.push(`target_id=$${vals.length}`) }
    if (f.from) { vals.push(f.from); where.push(`created_at >= $${vals.length}::date`) }
    if (f.to) { vals.push(f.to); where.push(`created_at < ($${vals.length}::date + interval '1 day')`) }
    const w = where.length ? `where ${where.join(' and ')}` : ''
    const page = Math.max(1, f.page ?? 1)
    const pageSize = Math.min(200, Math.max(1, f.pageSize ?? 50))
    const total = Number((await this.pool.query(`select count(*)::int n from admin_audit ${w}`, vals)).rows[0].n)
    const rows = (await this.pool.query(
      `select id, actor_id, actor_name, action, target_type, target_id, outcome, ip_hash, metadata_redacted, created_at
       from admin_audit ${w} order by id desc limit $${vals.length + 1} offset $${vals.length + 2}`,
      [...vals, pageSize, (page - 1) * pageSize]
    )).rows
    return { total, page, pageSize, rows: rows.map(r => ({
      id: Number(r.id), actorId: r.actor_id, actorName: r.actor_name, action: r.action,
      targetType: r.target_type, targetId: r.target_id, outcome: r.outcome, ipHash: r.ip_hash,
      metadata: r.metadata_redacted, createdAtMs: ms(r.created_at),
    })) }
  }

  /* ---------------- feedback state ---------------- */
  async allFeedbackState(gameId = 'bencaoyou'): Promise<FeedbackStateRow[]> {
    const r = await this.pool.query(
      `select f.*, u.username as assignee_name from feedback_state f left join admin_users u on u.id=f.assignee_id
       where f.game_id=$1`, [gameId]
    )
    return r.rows.map(mapFeedbackState)
  }

  async getFeedbackState(gameId: string, ownerId: string, key: string): Promise<FeedbackStateRow | null> {
    const r = await this.pool.query('select * from feedback_state where game_id=$1 and owner_id=$2 and storage_key=$3', [gameId, ownerId, key])
    return r.rows[0] ? mapFeedbackState(r.rows[0]) : null
  }

  async deleteFeedbackState(gameId: string, ownerId: string, key: string): Promise<boolean> {
    const r = await this.pool.query('delete from feedback_state where game_id=$1 and owner_id=$2 and storage_key=$3', [gameId, ownerId, key])
    return (r.rowCount ?? 0) > 0
  }

  async upsertFeedbackState(input: { gameId: string; ownerId: string; key: string; status: FeedbackStatus; assigneeId: string | null; note: string | null }): Promise<void> {
    await this.pool.query(
      `insert into feedback_state (game_id,owner_id,storage_key,status,assignee_id,note,updated_at)
       values ($1,$2,$3,$4,$5,$6,now())
       on conflict (game_id,owner_id,storage_key) do update set status=excluded.status, assignee_id=excluded.assignee_id, note=excluded.note, updated_at=now()`,
      [input.gameId, input.ownerId, input.key, input.status, input.assigneeId, input.note]
    )
  }

  /* ---------------- metrics ---------------- */
  async upsertDaily(gameId: string, day: string, metric: string, value: number, source: string): Promise<void> {
    await this.pool.query(
      `insert into metric_daily (game_id,day,metric,value,source,computed_at) values ($1,$2,$3,$4,$5,now())
       on conflict (game_id,day,metric) do update set value=excluded.value, source=excluded.source, computed_at=now()`,
      [gameId, day, metric, value, source]
    )
  }

  async queryDaily(gameId: string, fromDay: string, toDay: string, metrics: string[]) {
    const r = await this.pool.query(
      'select day, metric, value, source from metric_daily where game_id=$1 and day >= $2::date and day <= $3::date and metric = any($4) order by day asc',
      [gameId, fromDay, toDay, metrics]
    )
    return r.rows.map(x => ({ day: dayOf(x.day), metric: x.metric, value: Number(x.value), source: x.source }))
  }

  async upsertCohort(gameId: string, cohortDay: string, offsetDay: number, cohortSize: number, activeCount: number): Promise<void> {
    await this.pool.query(
      `insert into metric_cohort (game_id,cohort_day,offset_day,cohort_size,active_count) values ($1,$2,$3,$4,$5)
       on conflict (game_id,cohort_day,offset_day) do update set cohort_size=excluded.cohort_size, active_count=excluded.active_count`,
      [gameId, cohortDay, offsetDay, cohortSize, activeCount]
    )
  }

  async queryCohorts(gameId: string, fromDay: string) {
    const r = await this.pool.query(
      'select cohort_day, offset_day, cohort_size, active_count from metric_cohort where game_id=$1 and cohort_day >= $2::date order by cohort_day asc, offset_day asc',
      [gameId, fromDay]
    )
    return r.rows.map(x => ({ cohortDay: dayOf(x.cohort_day), offsetDay: Number(x.offset_day), cohortSize: Number(x.cohort_size), activeCount: Number(x.active_count) }))
  }

  async metricsComputedAt(gameId: string): Promise<number | null> {
    const r = await this.pool.query('select max(computed_at) t from metric_daily where game_id=$1', [gameId])
    return ms(r.rows[0]?.t)
  }

  /* ---------------- promo ---------------- */
  async listChannels(gameId: string): Promise<PromoChannel[]> {
    return (await this.pool.query('select * from promo_channels where game_id=$1 order by created_at asc', [gameId])).rows.map(mapChannel)
  }

  async createChannel(gameId: string, input: { code: string; name: string; platform?: string | null; notes?: string | null }): Promise<PromoChannel> {
    const r = await this.pool.query(
      'insert into promo_channels (id,game_id,code,name,platform,notes) values ($1,$2,$3,$4,$5,$6) returning *',
      [randomUUID(), gameId, input.code, input.name, input.platform ?? null, input.notes ?? null]
    )
    return mapChannel(r.rows[0])
  }

  async updateChannel(gameId: string, id: string, patch: { name?: string; platform?: string | null; status?: string; notes?: string | null }): Promise<PromoChannel | null> {
    const sets: string[] = [], vals: unknown[] = []
    for (const [k, col] of [['name', 'name'], ['platform', 'platform'], ['status', 'status'], ['notes', 'notes']] as const) {
      const v = (patch as Record<string, unknown>)[k]
      if (v !== undefined) { vals.push(v); sets.push(`${col}=$${vals.length}`) }
    }
    if (!sets.length) return null
    vals.push(gameId, id)
    const r = await this.pool.query(`update promo_channels set ${sets.join(',')} where game_id=$${vals.length - 1} and id=$${vals.length} returning *`, vals)
    return r.rows[0] ? mapChannel(r.rows[0]) : null
  }

  async listCampaigns(gameId: string): Promise<PromoCampaign[]> {
    const r = await this.pool.query(
      `select c.*, ch.code channel_code, ch.name channel_name from promo_campaigns c join promo_channels ch on ch.id=c.channel_id
       where c.game_id=$1 order by c.created_at desc`, [gameId]
    )
    return r.rows.map(mapCampaign)
  }

  async createCampaign(gameId: string, input: { channelId: string; name: string; startDay?: string | null; endDay?: string | null; budgetCents?: number | null; landingUrl?: string | null; notes?: string | null }): Promise<PromoCampaign> {
    const r = await this.pool.query(
      `insert into promo_campaigns (id,game_id,channel_id,name,start_day,end_day,budget_cents,landing_url,notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [randomUUID(), gameId, input.channelId, input.name, input.startDay ?? null, input.endDay ?? null, input.budgetCents ?? null, input.landingUrl ?? null, input.notes ?? null]
    )
    return mapCampaign(r.rows[0])
  }

  async updateCampaign(gameId: string, id: string, patch: Record<string, unknown>): Promise<PromoCampaign | null> {
    const cols: Record<string, string> = { name: 'name', startDay: 'start_day', endDay: 'end_day', budgetCents: 'budget_cents', landingUrl: 'landing_url', notes: 'notes', status: 'status' }
    const sets: string[] = [], vals: unknown[] = []
    for (const [k, col] of Object.entries(cols)) if (patch[k] !== undefined) { vals.push(patch[k]); sets.push(`${col}=$${vals.length}`) }
    if (!sets.length) return null
    vals.push(gameId, id)
    const r = await this.pool.query(`update promo_campaigns set ${sets.join(',')} where game_id=$${vals.length - 1} and id=$${vals.length} returning *`, vals)
    return r.rows[0] ? mapCampaign(r.rows[0]) : null
  }

  async listLinks(gameId: string): Promise<PromoLink[]> {
    const r = await this.pool.query(
      `select l.*, c.name campaign_name, ch.code channel_code from promo_links l
       join promo_campaigns c on c.id=l.campaign_id join promo_channels ch on ch.id=c.channel_id
       where l.game_id=$1 order by l.created_at desc`, [gameId]
    )
    return r.rows.map(mapLink)
  }

  async getLink(gameId: string, id: string): Promise<PromoLink | null> {
    const r = await this.pool.query(
      `select l.*, c.name campaign_name, ch.code channel_code from promo_links l
       join promo_campaigns c on c.id=l.campaign_id join promo_channels ch on ch.id=c.channel_id
       where l.game_id=$1 and l.id=$2`, [gameId, id]
    )
    return r.rows[0] ? mapLink(r.rows[0]) : null
  }

  async createLink(gameId: string, input: { campaignId: string; code: string; url: string; createdBy: string }): Promise<PromoLink> {
    const r = await this.pool.query(
      'insert into promo_links (id,game_id,campaign_id,code,url,created_by) values ($1,$2,$3,$4,$5,$6) returning *',
      [randomUUID(), gameId, input.campaignId, input.code, input.url, input.createdBy]
    )
    return mapLink(r.rows[0])
  }

  async upsertClicks(gameId: string, day: string, linkId: string, channelId: string | null, campaignId: string | null, clicks: number): Promise<void> {
    await this.pool.query(
      `insert into promo_clicks_daily (game_id,day,channel_id,campaign_id,link_id,clicks) values ($1,$2,$3,$4,$5,$6)
       on conflict (game_id,day,link_id) do update set clicks=promo_clicks_daily.clicks + excluded.clicks`,
      [gameId, day, channelId, campaignId, linkId, clicks]
    )
  }

  async clicksByLink(gameId: string, fromDay: string): Promise<Array<{ linkId: string | null; code: string | null; channelCode: string | null; campaignName: string | null; clicks: number }>> {
    const r = await this.pool.query(
      `select d.link_id, l.code, ch.code channel_code, c.name campaign_name, sum(d.clicks)::int clicks
       from promo_clicks_daily d left join promo_links l on l.id=d.link_id
       left join promo_campaigns c on c.id=d.campaign_id left join promo_channels ch on ch.id=d.channel_id
       where d.game_id=$1 and d.day >= $2::date group by 1,2,3,4 order by clicks desc`, [gameId, fromDay]
    )
    return r.rows.map(x => ({ linkId: x.link_id, code: x.code, channelCode: x.channel_code, campaignName: x.campaign_name, clicks: Number(x.clicks) }))
  }

  async clicksDaily(gameId: string, fromDay: string): Promise<Array<{ day: string; clicks: number }>> {
    const r = await this.pool.query(
      'select day, sum(clicks)::int clicks from promo_clicks_daily where game_id=$1 and day >= $2::date group by 1 order by 1', [gameId, fromDay]
    )
    return r.rows.map(x => ({ day: dayOf(x.day), clicks: Number(x.clicks) }))
  }

  async listImports(gameId: string) {
    return (await this.pool.query('select * from promo_imports where game_id=$1 order by imported_at desc limit 50', [gameId])).rows.map(x => ({
      id: x.id, filename: x.filename, fileHash: x.file_hash, importedBy: x.imported_by, importedAtMs: ms(x.imported_at), rowCount: Number(x.row_count),
    }))
  }

  async findImportByHash(gameId: string, hash: string) {
    const r = await this.pool.query('select id from promo_imports where game_id=$1 and file_hash=$2', [gameId, hash])
    return r.rows[0]?.id as string | undefined
  }

  async createImport(gameId: string, input: { filename: string; fileHash: string; importedBy: string; rowCount: number }): Promise<string> {
    const id = randomUUID()
    await this.pool.query(
      'insert into promo_imports (id,game_id,filename,file_hash,imported_by,row_count) values ($1,$2,$3,$4,$5,$6)',
      [id, gameId, input.filename, input.fileHash, input.importedBy, input.rowCount]
    )
    return id
  }

  async insertReportRows(importId: string, rows: Array<{ day: string; channelId: string | null; campaignId: string | null; impressions: number | null; clicks: number | null; spendCents: number | null }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      for (const r of rows) {
        await client.query(
          'insert into promo_report_rows (import_id,day,channel_id,campaign_id,impressions,clicks,spend_cents) values ($1,$2,$3,$4,$5,$6,$7)',
          [importId, r.day, r.channelId, r.campaignId, r.impressions, r.clicks, r.spendCents]
        )
      }
      await client.query('commit')
    } catch (e) { await client.query('rollback').catch(() => undefined); throw e } finally { client.release() }
  }

  async reportSummary(gameId: string, fromDay: string) {
    const r = await this.pool.query(
      `select coalesce(sum(r.impressions),0)::bigint impressions, coalesce(sum(r.clicks),0)::bigint clicks, coalesce(sum(r.spend_cents),0)::bigint spend_cents
       from promo_report_rows r join promo_imports i on i.id=r.import_id where i.game_id=$1 and r.day >= $2::date`, [gameId, fromDay]
    )
    return { impressions: Number(r.rows[0].impressions), clicks: Number(r.rows[0].clicks), spendCents: Number(r.rows[0].spend_cents) }
  }
}

function mapAdmin(r: Record<string, any>): AdminUserRow {
  return {
    id: r.id, username: r.username, passwordHash: r.password_hash, role: r.role, status: r.status,
    totpSecret: r.totp_secret, totpEnabled: r.totp_enabled, createdAtMs: ms(r.created_at) ?? 0,
    createdBy: r.created_by, lastLoginAtMs: ms(r.last_login_at),
  }
}
function mapSession(r: Record<string, any>): SessionRow {
  return {
    id: r.id, userId: r.user_id, username: r.username, role: r.role, totpEnabled: r.totp_enabled,
    createdAtMs: ms(r.created_at) ?? 0, lastSeenAtMs: ms(r.last_seen_at) ?? 0, expiresAtMs: ms(r.expires_at) ?? 0,
    ipHash: r.ip_hash, userAgentHash: r.user_agent_hash,
  }
}
function mapFeedbackState(r: Record<string, any>): FeedbackStateRow {
  return {
    ownerId: r.owner_id, storageKey: r.storage_key, status: r.status, assigneeId: r.assignee_id,
    assigneeName: r.assignee_name ?? null, note: r.note, updatedAtMs: ms(r.updated_at) ?? 0,
  }
}
function mapChannel(r: Record<string, any>): PromoChannel {
  return { id: r.id, code: r.code, name: r.name, platform: r.platform, status: r.status, notes: r.notes, createdAtMs: ms(r.created_at) ?? 0 }
}
function mapCampaign(r: Record<string, any>): PromoCampaign {
  return {
    id: r.id, channelId: r.channel_id, channelCode: r.channel_code, channelName: r.channel_name, name: r.name,
    startDay: r.start_day ? dayOf(r.start_day) : null, endDay: r.end_day ? dayOf(r.end_day) : null,
    budgetCents: r.budget_cents === null || r.budget_cents === undefined ? null : Number(r.budget_cents),
    landingUrl: r.landing_url, notes: r.notes, status: r.status, createdAtMs: ms(r.created_at) ?? 0,
  }
}
function mapLink(r: Record<string, any>): PromoLink {
  return {
    id: r.id, campaignId: r.campaign_id, campaignName: r.campaign_name, channelCode: r.channel_code,
    code: r.code, url: r.url, createdBy: r.created_by, createdAtMs: ms(r.created_at) ?? 0,
  }
}
