// Metrics ETL and read models. Raw telemetry is only aggregated here; owner IDs never reach the API.
import type { Store } from './store'
import { dayKeyUtc8, type NakamaReader } from './readers'

export const GAME_ID = 'bencaoyou'
const DAY_MS = 86400000
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

export type MetricDefinition = {
  key: string; label: string; definition: string; source: string; caveat: string
}

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: 'dau', label: '活跃用户（DAU）', definition: '当天有 app_open 或 login_success 的去重用户数', source: '埋点·需同意', caveat: '遥测为自愿开启；未同意的用户不计入。' },
  { key: 'new_users', label: '新增用户', definition: '当天在 Nakama 创建的账号数（设备 + 手机号）', source: 'Nakama 用户表', caveat: '设备账号与手机号账号是两条独立账号。' },
  { key: 'retention_d1', label: '次日回访率', definition: 'D 日首次活跃的用户中，D+1 日仍活跃的比例', source: '埋点·需同意', caveat: '仅统计开启遥测的用户。' },
  { key: 'tutorial_rate', label: '新手完成率', definition: '完成新手引导（或跳过后完成种植）的用户 / 区间新增用户', source: '存档', caveat: '以当前存档推断，非历史快照。' },
  { key: 'dujiangyan_rate', label: '都江堰两关完成率', definition: '都江堰两关均完成的用户 / 区间新增用户', source: '存档', caveat: '以当前存档推断。' },
  { key: 'export_rate', label: '游记导出率', definition: '触发 share_export 的用户 / 完成都江堰两关的用户', source: '埋点·需同意', caveat: '导出在客户端完成；存在同意偏差。' },
  { key: 'plant_rate', label: '种植率', definition: '发现植物或小院有摆放的用户 / 区间新增用户', source: '存档', caveat: '以当前存档推断。' },
  { key: 'feedback_unresolved', label: '未处理反馈', definition: '状态不是已解决/已归档的反馈数', source: '反馈存储 + 后台状态', caveat: '状态由运营在后台维护。' },
  { key: 'online', label: '当前在线（实名）', definition: '90 秒内有心跳且未关闭的会话语义用户数', source: 'Auth 会话', caveat: '仅实名模式产生会话。' },
]

export async function runMetrics(store: Store, nakama: NakamaReader, nowMs = Date.now(), days = 180): Promise<{ computedAt: number; days: number; cohorts: number }> {
  const toDay = dayKeyUtc8(nowMs)
  const fromDay = addDays(toDay, -(days - 1))

  const [newByDay, activeByDay, exportByDay, feedbackByDay] = await Promise.all([
    nakama.newUsersByDay(fromDay, toDay),
    nakama.activeUsersByDay(fromDay, toDay),
    nakama.exportUsersByDay(fromDay, toDay),
    nakama.feedbackByDay(fromDay, toDay),
  ])
  const get = (arr: Array<{ day: string; [k: string]: unknown }>, field: string) => {
    const m = new Map<string, number>()
    for (const x of arr) m.set(x.day, Number(x[field]))
    return m
  }
  const newMap = get(newByDay, 'users')
  const activeMap = get(activeByDay, 'users')
  const exportMap = get(exportByDay, 'users')
  const feedbackMap = get(feedbackByDay, 'rows')

  for (let i = 0; i < days; i++) {
    const day = addDays(fromDay, i)
    await store.upsertDaily(GAME_ID, day, 'dau', activeMap.get(day) ?? 0, '埋点·需同意')
    await store.upsertDaily(GAME_ID, day, 'new_users', newMap.get(day) ?? 0, 'Nakama 用户表')
    await store.upsertDaily(GAME_ID, day, 'share_export_users', exportMap.get(day) ?? 0, '埋点·需同意')
    await store.upsertDaily(GAME_ID, day, 'feedback_new', feedbackMap.get(day) ?? 0, 'Nakama 反馈存储')
  }

  // Cohorts: first active day → activity on D+0..D+7.
  const firstSeen = await nakama.firstSeenByUser()
  const cohortDays = Array.from(new Set([...firstSeen.values()])).sort()
  const recent = cohortDays.slice(-30)
  const activeCache = new Map<string, Set<string>>()
  const activeOn = async (day: string) => {
    if (!activeCache.has(day)) activeCache.set(day, await nakama.activeUserIdsOn(day))
    return activeCache.get(day)!
  }
  let cohortCount = 0
  for (const cohortDay of recent) {
    const cohort = [...firstSeen.entries()].filter(([, d]) => d === cohortDay).map(([id]) => id)
    if (!cohort.length) continue
    for (let off = 0; off <= 7; off++) {
      const day = addDays(cohortDay, off)
      if (day > toDay) break
      const active = await activeOn(day)
      const n = cohort.reduce((acc, id) => acc + (active.has(id) ? 1 : 0), 0)
      await store.upsertCohort(GAME_ID, cohortDay, off, cohort.length, n)
    }
    cohortCount++
  }
  return { computedAt: nowMs, days, cohorts: cohortCount }
}

type RangeCounts = {
  base: number
  appOpen: number
  login: number
  tutorial: number
  dujiangyan: number
  plant: number
  exportUsers: number
}

async function computeRange(_store: Store, nakama: NakamaReader, fromDay: string, toDay: string) {
  const baseIds = await nakama.userIdsCreated(fromDay, toDay)
  const baseSet = new Set(baseIds)
  const [appOpen, login, exported] = await Promise.all([
    nakama.eventUserIds('app_open', fromDay, toDay),
    nakama.eventUserIds('login_success', fromDay, toDay),
    nakama.eventUserIds('share_export', fromDay, toDay),
  ])
  const states = await nakama.playerStates(baseIds)
  const tutorialSet = new Set<string>(), dujiangyanSet = new Set<string>(), plantSet = new Set<string>()
  for (const id of baseIds) {
    const s = states.get(id)?.summary
    if (!s) continue
    if (s.tutorialStage === 'complete' || s.tutorialSkipped || s.gardenPlacements > 0) tutorialSet.add(id)
    if (s.dujiangyanCompleted) dujiangyanSet.add(id)
    if (s.plantsDiscovered > 0 || s.gardenPlacements > 0) plantSet.add(id)
  }
  const within = (set: Set<string>) => new Set([...set].filter(id => baseSet.has(id)))
  const appOpenBase = within(appOpen)
  const loginBase = within(login)
  const exportBase = within(exported)
  const intersect = (a: Set<string>, b: Set<string>) => new Set([...a].filter(id => b.has(id)))
  // Funnel steps are cumulative: each step is restricted to the users who reached the previous step.
  // This keeps telemetry-based and save-state-based steps comparable without inventing users.
  const f2 = intersect(appOpenBase, loginBase)
  const f3 = intersect(f2, tutorialSet)
  const f4 = intersect(f3, dujiangyanSet)
  const f5 = intersect(f4, plantSet)
  const f6 = intersect(f5, exportBase)
  const counts: RangeCounts = {
    base: baseIds.length,
    appOpen: appOpenBase.size,
    login: loginBase.size,
    tutorial: tutorialSet.size,
    dujiangyan: dujiangyanSet.size,
    plant: plantSet.size,
    exportUsers: exportBase.size,
  }
  return { counts, baseIds, baseSet, funnel: { appOpen: appOpenBase.size, login: f2.size, tutorial: f3.size, dujiangyan: f4.size, plant: f5.size, export: f6.size } }
}

export async function metricsSummary(store: Store, nakama: NakamaReader, nowMs = Date.now(), days = 7) {
  const toDay = dayKeyUtc8(nowMs)
  const fromDay = addDays(toDay, -(days - 1))
  const prevTo = addDays(fromDay, -1)
  const prevFrom = addDays(prevTo, -(days - 1))

  const [current, previous, previousDaily] = await Promise.all([
    computeRange(store, nakama, fromDay, toDay),
    computeRange(store, nakama, prevFrom, prevTo),
    store.queryDaily(GAME_ID, prevFrom, prevTo, ['dau']),
  ])
  const prevDauValues = previousDaily.map(x => x.value)
  const prevDauAvg = prevDauValues.length ? Math.round(prevDauValues.reduce((a, b) => a + b, 0) / prevDauValues.length) : 0
  const daily = await store.queryDaily(GAME_ID, fromDay, toDay, ['dau', 'new_users', 'share_export_users', 'feedback_new'])
  const dayMap = new Map<string, Record<string, number>>()
  for (let i = 0; i < days; i++) dayMap.set(addDays(fromDay, i), {})
  for (const row of daily) {
    const m = dayMap.get(row.day)
    if (m) m[row.metric] = row.value
  }
  const daysArr = [...dayMap.keys()]
  const dau = daysArr.map(d => dayMap.get(d)?.dau ?? 0)
  const newUsers = daysArr.map(d => dayMap.get(d)?.new_users ?? 0)
  const dauAvg = daysArr.filter(d => d < toDay).length
    ? Math.round(dau.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, daysArr.length - 1))
    : dau[dau.length - 1] ?? 0

  const cohorts = await store.queryCohorts(GAME_ID, addDays(toDay, -29))
  const retention = (offset: number) => {
    const rows = cohorts.filter(c => c.offsetDay === offset && addDays(c.cohortDay, offset) <= toDay)
    const size = rows.reduce((a, c) => a + c.cohortSize, 0)
    const active = rows.reduce((a, c) => a + c.activeCount, 0)
    return pct(active, size)
  }

  const c = current.counts, p = previous.counts
  const kpis = [
    { key: 'dau', label: '活跃用户（日均）', value: dauAvg, unit: '人', delta: deltaPct(dauAvg, prevDauAvg), source: '埋点·需同意' },
    { key: 'new_users', label: '新增用户', value: c.base, unit: '人', delta: deltaPct(c.base, p.base), source: 'Nakama 用户表' },
    { key: 'retention_d1', label: '次日回访率', value: retention(1), unit: '%', delta: null, source: '埋点·需同意' },
    { key: 'tutorial_rate', label: '新手完成率', value: pct(c.tutorial, c.base), unit: '%', delta: deltaPct(pct(c.tutorial, c.base), pct(p.tutorial, p.base)), source: '存档' },
    { key: 'dujiangyan_rate', label: '都江堰两关完成率', value: pct(c.dujiangyan, c.base), unit: '%', delta: deltaPct(pct(c.dujiangyan, c.base), pct(p.dujiangyan, p.base)), source: '存档' },
    { key: 'export_rate', label: '游记导出率', value: pct(c.exportUsers, c.dujiangyan), unit: '%', delta: deltaPct(pct(c.exportUsers, c.dujiangyan), pct(p.exportUsers, p.dujiangyan)), source: '埋点·需同意' },
  ]

  const funnel = [
    { key: 'app_open', label: '同意后打开', count: current.funnel.appOpen, source: '埋点·需同意' },
    { key: 'login', label: '服务器登录', count: current.funnel.login, source: '埋点·需同意' },
    { key: 'tutorial', label: '新手引导完成', count: current.funnel.tutorial, source: '存档' },
    { key: 'dujiangyan', label: '都江堰两关完成', count: current.funnel.dujiangyan, source: '存档' },
    { key: 'plant', label: '完成种植', count: current.funnel.plant, source: '存档' },
    { key: 'export', label: '游记导出', count: current.funnel.export, source: '埋点·需同意' },
  ]

  const retentionRows = [...new Set(cohorts.map(c => c.cohortDay))].sort().map(cohortDay => {
    const row: Record<string, number> = {}
    let size = 0
    for (const c of cohorts.filter(x => x.cohortDay === cohortDay)) {
      row[`d${c.offsetDay}`] = pct(c.activeCount, c.cohortSize)
      size = c.cohortSize
    }
    return { cohortDay, cohortSize: size, values: row }
  })

  return {
    range: { from: fromDay, to: toDay, days },
    kpis,
    series: { days: daysArr, dau, newUsers },
    funnel,
    retention: { offsets: [0, 1, 2, 3, 4, 5, 6, 7], rows: retentionRows, d1: retention(1), d7: retention(7) },
    sources: { consentBias: true, note: '埋点指标只覆盖自愿开启“帮助改进体验”的用户。' },
    computedAt: await store.metricsComputedAt(GAME_ID),
  }
}

function deltaPct(current: number, previous: number): number | null {
  if (!previous) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

export function metricsCsv(summary: Awaited<ReturnType<typeof metricsSummary>>): string {
  const lines = ['type,key,label,value,unit,source']
  for (const k of summary.kpis) lines.push(`kpi,${k.key},${csv(k.label)},${k.value},${k.unit},${csv(k.source)}`)
  for (const f of summary.funnel) lines.push(`funnel,${f.key},${csv(f.label)},${f.count},人,${csv(f.source)}`)
  for (let i = 0; i < summary.series.days.length; i++) {
    lines.push(`daily,dau,${summary.series.days[i]},${summary.series.dau[i]},人,埋点·需同意`)
    lines.push(`daily,new_users,${summary.series.days[i]},${summary.series.newUsers[i]},人,Nakama 用户表`)
  }
  return lines.join('\n')
}
const csv = (v: string) => {
  const text = String(v)
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
