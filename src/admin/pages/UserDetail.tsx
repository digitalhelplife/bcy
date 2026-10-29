import { useState } from 'react'
import { ACCOUNT_LABELS, FEEDBACK_LABELS, fmt, REALNAME_LABELS, TUTORIAL_LABELS, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, CopyButton, Empty, ErrorBox, Loading, PageHead, Tabs } from '../ui'

type Detail = {
  user: { id: string; customId: string; username: string | null; loginMethod: 'phone' | 'device'; authUserId: string | null; createdAtMs: number }
  identity: { realnameStatus: string; accountStatus: string; authCreatedAtMs: number | null; deletedAtMs: number | null; deletions: Array<{ requestId: string; completedAtMs: number }> }
  progress: null | {
    stateRevision: number; tutorialStage: string; tutorialSkipped: boolean; plantsDiscovered: number; plantsOwned: number
    gardenPlacements: number; levelsCompleted: number; completedLevels: string[]; dujiangyanCompleted: boolean; seasonClaims: number
    observations: number; quizStamps: number; parentMode: boolean; telemetryConsent: boolean; updatedAtMs: number
  }
  sessions: Array<{ startedAtMs: number; lastAtMs: number; closed: boolean }>
  feedback: Array<{ key: string; atMs: number; excerpt: string; clientBuild: string | null; status: string }>
  audit: Array<{ id: number; actorName: string | null; action: string; outcome: string; createdAtMs: number }>
  runs: Array<{ key: string; value: any; updateTimeMs: number }>
}

type Tab = 'overview' | 'progress' | 'sessions' | 'feedback' | 'audit'

export function UserDetail({ id }: { id: string }) {
  const { navigate } = useRouter()
  const [tab, setTab] = useState<Tab>('overview')
  const d = useApi<Detail>(`/users/${encodeURIComponent(id)}`, [id])

  if (d.loading && !d.data) return <Loading />
  if (d.error) return <><PageHead title="用户详情" actions={<button className="btn" onClick={() => navigate('/users')}>返回列表</button>} /><ErrorBox error={d.error} onRetry={d.reload} /></>
  if (!d.data) return null
  const { user, identity, progress, sessions, feedback, audit, runs } = d.data

  async function exportProfile() {
    const r = await fetch(`/admin/api/users/${encodeURIComponent(user.id)}/export`, { credentials: 'same-origin' })
    if (!r.ok) return
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `user-${user.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHead
        title={`用户 ${fmt.short(user.id, 12)}`}
        desc={user.username ? `昵称 ${user.username}` : '未命名设备账号'}
        actions={<>
          <button className="btn" onClick={() => navigate('/users')}>返回列表</button>
          <button className="btn" onClick={exportProfile}>导出脱敏档案</button>
        </>}
      />

      <Card className="flush">
        <div style={{ padding: 18 }}>
          <div className="row-wrap">
            <span className="mono">{user.id}</span><CopyButton text={user.id} />
            <Chip kind={user.loginMethod === 'phone' ? 'info' : 'mute'}>{user.loginMethod === 'phone' ? '手机号' : '设备试玩'}</Chip>
            <Chip kind={identity.realnameStatus.startsWith('VERIFIED') ? 'ok' : identity.realnameStatus === 'PENDING' ? 'warn' : 'mute'}>{REALNAME_LABELS[identity.realnameStatus] ?? identity.realnameStatus}</Chip>
            <Chip kind={identity.accountStatus === 'ACTIVE' ? 'ok' : 'danger'}>{ACCOUNT_LABELS[identity.accountStatus] ?? identity.accountStatus}</Chip>
          </div>
          <div className="kv kv-3" style={{ marginTop: 14 }}>
            <div><dt>注册时间</dt><dd>{fmt.time(user.createdAtMs)}</dd></div>
            <div><dt>最近存档</dt><dd>{progress ? fmt.time(progress.updatedAtMs) : '—'}</dd></div>
            <div><dt>认证账号</dt><dd className="mono">{user.authUserId ? fmt.short(user.authUserId, 14) : '设备模式无认证记录'}</dd></div>
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 18 }}>
        <Tabs<Tab> value={tab} onChange={setTab} items={[
          { key: 'overview', label: '概览' }, { key: 'progress', label: '游戏进度' }, { key: 'sessions', label: '会话' },
          { key: 'feedback', label: `反馈 (${feedback.length})` }, { key: 'audit', label: '审计' },
        ]} />

        {tab === 'overview' ? (
          <div className="grid grid-2">
            <Card title="身份与账号">
              <div className="kv">
                <div><dt>登录方式</dt><dd>{user.loginMethod === 'phone' ? '手机号登录' : '设备试玩'}</dd></div>
                <div><dt>实名状态</dt><dd>{REALNAME_LABELS[identity.realnameStatus] ?? identity.realnameStatus}</dd></div>
                <div><dt>账号状态</dt><dd>{ACCOUNT_LABELS[identity.accountStatus] ?? identity.accountStatus}</dd></div>
                <div><dt>认证账号创建</dt><dd>{fmt.time(identity.authCreatedAtMs)}</dd></div>
                <div><dt>注销时间</dt><dd>{fmt.time(identity.deletedAtMs)}</dd></div>
                <div><dt>注销记录</dt><dd>{identity.deletions.length ? `${identity.deletions.length} 次` : '无'}</dd></div>
              </div>
              <div className="banner neutral" style={{ marginTop: 14 }}>后台不显示手机号明文、姓名或身份证号。</div>
            </Card>
            <Card title="进度快照" sub={progress ? `stateRevision ${progress.stateRevision}` : '无存档'}>
              {progress ? (
                <>
                  <div className="stat-inline">
                    <div><b>{progress.plantsDiscovered}</b><span>已发现植物</span></div>
                    <div><b>{progress.levelsCompleted}/6</b><span>完成关卡</span></div>
                    <div><b>{progress.gardenPlacements}</b><span>小院摆放</span></div>
                    <div><b>{progress.quizStamps}</b><span>知识印章</span></div>
                  </div>
                  <div className="divider" />
                  <div className="kv">
                    <div><dt>新手阶段</dt><dd>{TUTORIAL_LABELS[progress.tutorialStage] ?? progress.tutorialStage}{progress.tutorialSkipped ? '（已跳过）' : ''}</dd></div>
                    <div><dt>都江堰两关</dt><dd>{progress.dujiangyanCompleted ? <Chip kind="ok">已完成</Chip> : <Chip kind="mute">未完成</Chip>}</dd></div>
                    <div><dt>节气领取</dt><dd>{progress.seasonClaims}</dd></div>
                    <div><dt>观察记录</dt><dd>{progress.observations}</dd></div>
                    <div><dt>亲子模式</dt><dd>{progress.parentMode ? '开启' : '关闭'}</dd></div>
                    <div><dt>遥测授权</dt><dd>{progress.telemetryConsent ? '已同意' : '未同意'}</dd></div>
                  </div>
                </>
              ) : <Empty title="没有存档" hint="设备账号在首次进入游戏后才会写入存档。" />}
            </Card>
          </div>
        ) : null}

        {tab === 'progress' ? (
          <div className="stack">
            <Card title="关卡进度" sub="服务端存档中的首通记录">
              {progress ? (
                <div className="grid grid-3">
                  {['dujiangyan_find', 'dujiangyan_puzzle', 'qingcheng_find', 'qingcheng_puzzle', 'jiezi_find', 'jiezi_puzzle'].map(lv => {
                    const done = progress.completedLevels.includes(lv)
                    return <div className="banner neutral" key={lv}><Chip kind={done ? 'ok' : 'mute'}>{done ? '已完成' : '未完成'}</Chip> <span className="mono">{lv}</span></div>
                  })}
                </div>
              ) : <Empty title="没有存档" />}
            </Card>
            <Card title="最近对局" sub="来自 game_runs（最多 30 条）">
              {runs.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>关卡</th><th>路线</th><th>状态</th><th>更新时间</th></tr></thead>
                    <tbody>{runs.map(r => (
                      <tr key={r.key}>
                        <td className="mono">{r.value?.levelId ?? '—'}</td>
                        <td>{r.value?.route === 'plant' ? '植物' : r.value?.route === 'decor' ? '装饰' : '—'}</td>
                        <td><Chip kind={r.value?.status === 'FINISHED' ? 'ok' : 'mute'}>{r.value?.status ?? '—'}</Chip></td>
                        <td>{fmt.time(r.updateTimeMs)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <Empty title="暂无对局记录" />}
            </Card>
          </div>
        ) : null}

        {tab === 'sessions' ? (
          <Card title="会话记录" sub="仅实名模式产生 playtime_sessions">
            {sessions.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>开始</th><th>最后心跳</th><th>状态</th><th className="num">时长</th></tr></thead>
                  <tbody>{sessions.map((s, i) => (
                    <tr key={i}>
                      <td>{fmt.time(s.startedAtMs)}</td><td>{fmt.time(s.lastAtMs)}</td>
                      <td><Chip kind={s.closed ? 'mute' : 'ok'}>{s.closed ? '已结束' : '进行中'}</Chip></td>
                      <td className="num">{Math.max(0, Math.round((s.lastAtMs - s.startedAtMs) / 60000))} 分钟</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty title="没有会话数据" hint="设备试玩模式不产生实名会话。" />}
          </Card>
        ) : null}

        {tab === 'feedback' ? (
          <Card title="该用户的反馈">
            {feedback.length ? (
              <div className="stack" style={{ gap: 10 }}>
                {feedback.map(f => (
                  <div key={f.key} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
                    <div className="row">
                      <Chip kind={f.status === 'NEW' ? 'warn' : f.status === 'IN_PROGRESS' ? 'info' : f.status === 'RESOLVED' ? 'ok' : 'mute'}>{FEEDBACK_LABELS[f.status] ?? f.status}</Chip>
                      <span className="dim">{fmt.time(f.atMs)}</span>
                      {f.clientBuild ? <span className="mono dim">{f.clientBuild}</span> : null}
                    </div>
                    <div style={{ marginTop: 4 }}>{f.excerpt}</div>
                    <button className="btn link" style={{ marginTop: 4 }} onClick={() => navigate('/ops/feedback')}>去反馈收件箱处理</button>
                  </div>
                ))}
              </div>
            ) : <Empty title="没有反馈" />}
          </Card>
        ) : null}

        {tab === 'audit' ? (
          <Card title="与该用户相关的后台操作">
            {audit.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>结果</th></tr></thead>
                  <tbody>{audit.map(a => (
                    <tr key={a.id}><td>{fmt.time(a.createdAtMs)}</td><td>{a.actorName ?? '—'}</td><td className="mono">{a.action}</td><td><Chip kind={a.outcome === 'OK' ? 'ok' : a.outcome === 'DENIED' ? 'danger' : 'mute'}>{a.outcome}</Chip></td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <Empty title="没有审计记录" />}
          </Card>
        ) : null}
      </div>
    </>
  )
}
