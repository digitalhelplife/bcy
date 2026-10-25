import { useEffect, useRef, useState } from 'react'
import { CLIENT_BUILD, COMPLIANCE, CONTENT_NOTICE, CRAFT_ITEM_IDS, DECOR_IDS, ITEMS, PLANTS, SCENES, SCENE_ORDER, SHARE, TRIAL_NOTICE, type ShareTemplateId } from '../../shared/content'
import { codepointLength, isSceneOpen, placedCount } from '../../shared/rules'
import { CraftSheet } from './Craft'
import { useParentMode, readConsent, writeConsent, useSound, useVoice, useKidAge, useAmbient } from '../prefs'
import { play } from '../sfx'
import type { PlantId, SceneId } from '../../shared/types'
import { clearRunCaches } from '../../phaser/bridge'
import { MAX_STICKERS, canvasToBlob, renderShare, validateTitle } from '../../share/exportShare'
import { DEFAULT_CROP, type Crop, type LocalPhoto } from '../../share/photo'
import { PhotoComposer } from './PhotoComposer'
import { activeEvent } from '../../shared/events'
import { TransferCard } from './Transfer'
import { Btn, Img, errorText, useApp, useSnap } from '../common'
import { BloggerKit } from './BloggerKit'
import { SEARCH_PHRASE, blobToDataUrl, copyText, detectInApp, gameLink } from '../inApp'

export function InventoryScreen() {
  const s = useSnap().state!
  const [craft, setCraft] = useState(false)
  const groups: [string, 'seed' | 'plant' | 'decor' | 'craft'][] = [['种子', 'seed'], ['成熟植物', 'plant'], ['景点摆件', 'decor'], ['手作摆件', 'craft']]
  return (
    <div className="screen page">
      <div className="row"><h2>背包</h2><Btn small kind="soft" onClick={() => setCraft(true)} testId="open-craft">手作台</Btn></div>
      {groups.map(([label, kind]) => {
        const items = Object.values(ITEMS).filter(i => (kind === 'craft' ? CRAFT_ITEM_IDS.includes(i.itemId) : kind === 'decor' ? DECOR_IDS.includes(i.itemId) : i.kind === kind) && (s.inventory[i.itemId] ?? 0) > 0)
        return (
          <section key={kind}>
            <h3>{label}</h3>
            {items.length === 0 ? <p className="tiny muted">暂无</p> : (
              <div className="inv-grid">
                {items.map(it => {
                  const total = s.inventory[it.itemId] ?? 0; const placed = kind === 'seed' ? 0 : placedCount(s.garden.placements, it.itemId)
                  return (
                    <div key={it.itemId} className="inv-cell">
                      <Img path={it.icon} />
                      <b>{it.name}</b>
                      <span className="tiny">{kind === 'seed' ? `拥有 ${total}` : `拥有 ${total} · 已摆放 ${placed} · 可用 ${total - placed}`}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )
      })}
      {craft && <CraftSheet onClose={() => setCraft(false)} />}
    </div>
  )
}

export function ShareScreen({ template, plantId: initialPlantId }: { template?: ShareTemplateId; plantId?: PlantId } = {}) {
  const { toast, client, confirm } = useApp()
  const s = useSnap().state!
  const initialTemplate = template ?? 'share_scenic'
  const [tpl, setTpl] = useState<ShareTemplateId>(initialTemplate)
  const [title, setTitle] = useState<string>(SHARE.templates[initialTemplate].defaultTitle)
  const openScenes = SCENE_ORDER.filter(id => isSceneOpen(s, id))
  const [sceneId, setSceneId] = useState<SceneId>(openScenes[0])
  const [plantId, setPlantId] = useState<PlantId | null>(initialPlantId ?? s.discoveredPlantIds[0] ?? null)
  const [url, setUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const inApp = detectInApp()
  const [saveView, setSaveView] = useState<string | null>(null)
  const [stickers, setStickers] = useState<PlantId[]>([])
  const toggleSticker = (id: PlantId) => { setUrl(null); setStickers(cur => cur.includes(id) ? cur.filter(x => x !== id) : cur.length >= MAX_STICKERS ? cur : [...cur, id]) }
  const [photo, setPhotoRaw] = useState<LocalPhoto | null>(null)
  const [crop, setCropRaw] = useState<Crop>(DEFAULT_CROP)
  const photoRef = useRef<LocalPhoto | null>(null)
  const setPhoto = (p: LocalPhoto | null) => { if (photoRef.current && photoRef.current !== p) photoRef.current.release(); photoRef.current = p; setPhotoRaw(p); setUrl(null) }
  const setCrop = (c: Crop) => { setCropRaw(c); setUrl(null) }
  // Release the decoded photo when leaving the page (doc 05 §8.4).
  useEffect(() => () => { photoRef.current?.release(); photoRef.current = null }, [])
  const titleErr = validateTitle(title)
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const pick = (t: ShareTemplateId) => { setTpl(t); setTitle(SHARE.templates[t].defaultTitle); setCropRaw(DEFAULT_CROP); setUrl(null) }
  const unavailable = (tpl === 'share_plant' || tpl === 'share_nature') && !plantId ? '还没有发现植物，先完成一关探索吧' : null
  const make = async () => {
    if (titleErr || unavailable) return
    setBusy(true)
    try {
      const ph = photo ? { photo, crop } : null
      const st = stickers.filter(id => s.discoveredPlantIds.includes(id))
      const canvas = await renderShare(
        tpl === 'share_scenic' ? { templateId: tpl, title, sceneId, photo: ph, stickers: st }
          : tpl === 'share_plant' ? { templateId: tpl, title, plantId: plantId!, photo: ph, stickers: st }
            : tpl === 'share_nature' ? { templateId: tpl, title, plantId: plantId!, observations: s.observations[plantId!] ?? [], photo: ph }
              : { templateId: tpl, title, garden: s.garden, photo: ph, stickers: st },
      )
      const b = await canvasToBlob(canvas)
      if (url) URL.revokeObjectURL(url)
      setBlob(b); setUrl(URL.createObjectURL(b))
      // A5 G2: in-app WebViews often block downloads and blob long-press; a data URL in a full-screen view is the most reliable.
      if (inApp) setSaveView(await blobToDataUrl(b))
      client.track('share_export', { templateId: tpl, hasPhoto: !!photo })
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  const fileName = `bencao-chengdu-${tpl.replace('share_', '')}-${Date.now()}.png`
  const systemShare = async () => {
    if (!blob) return
    const file = new File([blob], fileName, { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: '本草小游记·成都篇' }); client.track('share_system_share', { templateId: tpl }) }
      else toast('当前浏览器不支持直接分享，请下载或长按图片保存')
    } catch { /* user cancelled */ }
  }
  return (
    <div className="screen page">
      <h2>导出游记</h2>
      <div className="tabs">{(Object.keys(SHARE.templates) as ShareTemplateId[]).map(t => <button key={t} className={tpl === t ? 'on' : ''} onClick={() => pick(t)}>{SHARE.templates[t].name}</button>)}</div>
      {tpl === 'share_scenic' && <div className="row wrap">{openScenes.map(id => <button key={id} className={`chip${sceneId === id ? ' on' : ''}`} onClick={() => { setSceneId(id); setUrl(null) }}>{SCENES[id].displayName}</button>)}</div>}
      {(tpl === 'share_plant' || tpl === 'share_nature') && <div className="row wrap">{s.discoveredPlantIds.map(id => <button key={id} className={`chip${plantId === id ? ' on' : ''}`} onClick={() => { setPlantId(id); setUrl(null) }}>{PLANTS[id].name}</button>)}</div>}
      {tpl === 'share_plant' && <p className="tiny muted">导出的是已发现的植物图鉴插画。</p>}
      {tpl === 'share_nature' && <p className="tiny muted">把这种植物的 4 个观察阶段做成手账页；已记录 {(s.observations[plantId ?? ''] ?? []).length}/4。照片和孩子的画只在本机合成。</p>}
      {tpl === 'share_garden' && <p className="tiny muted">导出的是已保存的小院布局（{s.garden.placements.length} 件摆件）。</p>}
      <label className="field">
        <span>标题（{codepointLength(title)}/30）</span>
        <input value={title} onChange={e => { setTitle(e.target.value); setUrl(null) }} placeholder="可留空" data-testid="share-title" />
      </label>
      {(() => { const ev = activeEvent(client.serverNow()); return ev && title !== ev.journalTitle ? <button className="chip" data-testid="event-title" onClick={() => { setTitle(ev.journalTitle); setUrl(null) }}>用活动标题：{ev.journalTitle}</button> : null })()}
      {tpl !== 'share_nature' && s.discoveredPlantIds.length > 0 && (
        <div className="field" data-testid="stickers">
          <span>植物贴纸（{stickers.length}/{MAX_STICKERS}，来自图鉴，贴在画面上方两角）</span>
          <div className="row wrap">{s.discoveredPlantIds.map(id => (
            <button key={id} className={`chip sticker-chip${stickers.includes(id) ? ' on' : ''}`} disabled={!stickers.includes(id) && stickers.length >= MAX_STICKERS} onClick={() => toggleSticker(id)} data-testid={`sticker-${id}`}>
              <Img path={`plants/plant_${id}_icon`} />{PLANTS[id].name}
            </button>
          ))}</div>
        </div>
      )}
      <PhotoComposer templateId={tpl} photo={photo} crop={crop} onPhoto={setPhoto} onCrop={setCrop} confirm={confirm} toast={toast} />
      {titleErr && <div className="error-line">{titleErr}</div>}
      {unavailable && <div className="error-line">{unavailable}</div>}
      <Btn onClick={make} disabled={busy || !!titleErr || !!unavailable} testId="make-share">{busy ? '生成中…' : '生成游记图片'}</Btn>
      {url && (
        <div className="share-preview">
          <img src={url} alt="游记预览" data-testid="share-preview" />
          {inApp
            ? <div className="row"><Btn small onClick={async () => setSaveView(await blobToDataUrl(blob!))} testId="share-save-view">全屏查看并保存</Btn></div>
            : <div className="row">
                <a className="btn btn-primary btn-sm" href={url} download={fileName}>下载图片</a>
                <Btn small kind="ghost" onClick={systemShare}>系统分享</Btn>
              </div>}
          <p className="tiny muted">也可以长按图片保存到相册。导出不会自动发布，也不会因分享获得奖励。</p>
        </div>
      )}
      {saveView && (
        <div className="save-view" role="dialog" aria-label="长按保存图片" data-testid="share-save-overlay" onClick={e => { if (e.target === e.currentTarget) setSaveView(null) }}>
          <p className="save-hint">长按图片 → 选择「保存图片」或「存储到相册」</p>
          <img src={saveView} alt="本草小游记游记图片" />
          <p className="tiny">{inApp ? `如果${inApp.name}里长按没有反应，可以截屏保存，或复制链接到浏览器打开再导出。` : '长按没有反应时，可以截屏保存。'}</p>
          <Btn kind="ghost" small onClick={() => setSaveView(null)} testId="share-save-close">关闭</Btn>
        </div>
      )}
      <BloggerKit />
    </div>
  )
}

export function SettingsScreen() {
  const { client, go, toast, confirm } = useApp()
  const snap = useSnap(); const s = snap.state!
  const [ambient, setAmbient] = useAmbient()
  const [kidAge, setKidAge] = useKidAge()
  const [parent, setParent] = useParentMode()
  const [sound, setSound] = useSound(); const [voice, setVoice] = useVoice()
  const [fb, setFb] = useState(''); const [contact, setContact] = useState(''); const [sending, setSending] = useState(false)
  const parentSynced = useRef(false)
  const toggleParent = async (on: boolean) => {
    setParent(on)
    client.track('parent_mode_toggle', { on })
    if (snap.mode !== 'nakama') return
    try { await client.settingsUpdate(on) } catch (e) { setParent(!on); toast(errorText(e)) }
  }
  // On the first ready state in Nakama mode, let the server preference win (cross-device sync).
  useEffect(() => {
    if (parentSynced.current || snap.mode !== 'nakama' || !snap.state) return
    parentSynced.current = true
    if (snap.state.settings.parentMode !== parent) setParent(snap.state.settings.parentMode)
  }, [snap.mode, snap.state, parent, setParent])
  const tutorialOpen = !s.tutorialSkipped && s.tutorialStage !== 'complete'
  const pub = COMPLIANCE.publicationInfo
  const setTelemetry = async (on: boolean) => {
    try {
      await client.syncConsent(COMPLIANCE.privacyPolicyVersion, on)
      writeConsent({ ...(readConsent() ?? { acceptedAtMs: Date.now() }), privacyVersion: COMPLIANCE.privacyPolicyVersion, telemetry: on })
      toast(on ? '已开启“帮助改进体验”' : '已关闭，不再上报任何统计')
    } catch (e) { toast(errorText(e)) }
  }
  const sendFb = async () => {
    setSending(true)
    try { await client.feedbackSubmit(fb, contact); setFb(''); setContact(''); toast('已收到，我们会在 15 个工作日内处理') } catch (e) { toast(errorText(e)) } finally { setSending(false) }
  }
  const del = () => confirm({
    title: '确定注销账号？', body: '会删除服务器上的全部进度（植物、小院、图鉴、问答印章）且无法恢复。本机缓存也会一并清除。',
    actions: [{ label: '再想想', kind: 'ghost' }, { label: '确认注销', kind: 'danger', onClick: async () => { try { await client.accountDelete(); toast('账号已注销'); setTimeout(() => location.reload(), 1200) } catch (e) { toast(errorText(e)) } } }],
  })
  return (
    <div className="screen page">
      <h2>设置与说明</h2>
      <section className="card">
        <h3>存档方式</h3>
        {snap.mode === 'demo'
          ? <p><b>本地演示模式</b>：当前未配置 Nakama 服务器，进度只保存在这个浏览器中，不是云存档，也不提供服务端防作弊。</p>
          : <p><b>试玩账号（设备登录）</b>：{TRIAL_NOTICE} 手机号登录与实名认证将在正式上线前开放。</p>}
        <p className="tiny muted">账号编号：{snap.userId}</p>
      </section>
      <section className="card col">
        <h3>亲子与隐私</h3>
        <label className="switch"><input type="checkbox" checked={parent} onChange={e => void toggleParent(e.target.checked)} data-testid="parent-mode" /><span>亲子模式：放大字号，显示“亲子一起说”提示和自然挑战注意事项（登录账号后跨设备同步）</span></label>
        {parent && <div className="row wrap age-row" data-testid="kid-age"><span className="tiny">孩子年龄：</span>{(['3-6', '7-12'] as const).map(a => <button key={a} className={`chip${kidAge === a ? ' on' : ''}`} onClick={() => { setKidAge(a); client.track('kid_age', { age: a }) }}>{a} 岁</button>)}<span className="tiny muted">7–12 岁每关结算多一道“想一想”。</span></div>}
        <label className="switch"><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); if (e.target.checked) setTimeout(() => play('tap'), 0) }} data-testid="sound" /><span>音效（音量很小，默认开）</span></label>
        {<label className="switch"><input type="checkbox" checked={voice} onChange={e => setVoice(e.target.checked)} data-testid="voice" /><span>亲子模式朗读：用录好的普通话语音读出找物目标和“讲给孩子听”（不需要麦克风，不上传任何声音）</span></label>}
        <label className="switch"><input type="checkbox" checked={ambient} onChange={e => setAmbient(e.target.checked)} data-testid="ambient" /><span>景点环境音：闯关时轻轻播放水声、山林鸟鸣或古镇檐铃（默认关闭，音量很小）</span></label>
        <label className="switch"><input type="checkbox" checked={s.consent.telemetry} onChange={e => void setTelemetry(e.target.checked)} data-testid="telemetry" /><span>帮助改进体验（默认关闭，只上报去标识化的操作事件）</span></label>
        <details><summary>隐私摘要（版本 {COMPLIANCE.privacyPolicyVersion}）</summary><ul className="tiny">{COMPLIANCE.privacySummary.map(t => <li key={t}>{t}</li>)}</ul></details>
        <p className="tiny"><a href="./legal/privacy.html">查看《隐私政策》全文</a> · <a href="./legal/terms.html">查看《用户协议》全文</a></p>
      </section>
      <section className="card col">
        <h3>意见反馈与投诉举报</h3>
        <textarea value={fb} maxLength={500} onChange={e => setFb(e.target.value)} placeholder="遇到问题、内容有误或想投诉举报，都可以写在这里（最多 500 字）" data-testid="feedback-text" />
        <input value={contact} maxLength={100} onChange={e => setContact(e.target.value)} placeholder="联系方式（选填）" />
        <Btn small disabled={!fb.trim() || sending} onClick={sendFb} testId="feedback-send">{sending ? '提交中…' : `提交（${codepointLength(fb.trim())}/500）`}</Btn>
        <p className="tiny muted">{COMPLIANCE.feedbackChannel}</p>
      </section>
      <TransferCard />
      <section className="card col" data-testid="share-friends">
        <h3>分享给朋友</h3>
        <p className="tiny">小红书笔记里的链接点不开，可以让朋友搜索口令，或把链接发到微信。</p>
        <div className="row wrap">
          <Btn small kind="soft" onClick={async () => toast(await copyText(gameLink()) ? '游戏链接已复制' : '复制失败，请手动复制地址栏')} testId="copy-link">复制游戏链接</Btn>
          <Btn small kind="soft" onClick={async () => toast(await copyText(SEARCH_PHRASE) ? `已复制口令「${SEARCH_PHRASE}」` : '复制失败')} testId="copy-phrase">复制搜索口令</Btn>
        </div>
        <p className="tiny muted">口令：{SEARCH_PHRASE}。分享不会获得任何奖励。</p>
      </section>
      <section className="card"><h3>内容说明</h3><p className="tiny">{CONTENT_NOTICE}</p><p className="tiny">{COMPLIANCE.nonOfficialStatement}</p></section>
      <section className="card">
        <h3>健康游戏忠告</h3><p className="tiny">{COMPLIANCE.healthGameAdvice}</p>
        <p className="tiny">适龄提示：{COMPLIANCE.ageRating.display} · {COMPLIANCE.ageRating.description}</p>
        <p className="tiny muted">著作权人：{pub.copyrightOwner || '待填写'} · 出版服务单位：{pub.publishingServiceUnit || '待填写'} · 审批文号：{pub.approvalNo || '待取得'} · 出版物号：{pub.publicationNo || '待取得'}</p>
        <p className="tiny muted">当前为测试版本，未取得版号前不对公众正式运营。</p>
      </section>
      <section className="card col">
        {tutorialOpen && <Btn kind="ghost" onClick={async () => { try { await client.tutorialSkip(); toast('已跳过新手引导') } catch (e) { toast(errorText(e)) } }}>跳过新手引导</Btn>}
        <Btn kind="ghost" onClick={() => confirm({ title: '重置界面？', body: '只清理本机的探索缓存和小院草稿，不会删除已保存的进度。', actions: [{ label: '取消', kind: 'ghost' }, { label: '重置', kind: 'danger', onClick: () => { clearRunCaches(); for (const k of Object.keys(localStorage)) if (k.startsWith('bcy.gardenDraft')) localStorage.removeItem(k); go({ name: 'map' }) } }] })}>重置界面</Btn>
        <Btn kind="ghost" onClick={() => location.reload()}>重新加载资源</Btn>
        {client.authMode === 'realname' && <p className="tiny muted">登录方式：手机号 · 实名状态：{({ VERIFIED_ADULT: '已认证', VERIFIED_MINOR: '已认证（未成年人）', PENDING: '审核中', UNVERIFIED: '未认证' } as const)[snap.account?.realnameStatus ?? 'UNVERIFIED']}</p>}
        {client.authMode === 'realname' && <Btn kind="ghost" onClick={() => void client.logout()} testId="logout">退出登录</Btn>}
        <Btn kind="danger" onClick={del} testId="delete-account">注销账号并删除数据</Btn>
      </section>
      <p className="tiny muted">本草小游记·成都篇 v{CLIENT_BUILD} · Phaser 4.2.1 · 内容 chengdu_content_v1（审核中）</p>
    </div>
  )
}
