import { useState } from 'react'
import { CRAFTS, CRAFT_RULES, ITEMS, PLANTS } from '../../shared/content'
import { availableCount, isRecipeOpen, matchRecipe } from '../../shared/rules'
import type { Grant } from '../../shared/types'
import { Btn, Img, Sheet, errorText, useApp, useSnap } from '../common'

/** P66: turn mature plants into a garden keepsake. Plants already placed in the garden are never consumed. */
export function CraftSheet({ onClose }: { onClose: () => void }) {
  const { client, toast } = useApp()
  const s = useSnap().state!
  const now = client.serverNow()
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [pick, setPick] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const r = recipeId ? CRAFTS[recipeId] : null
  const units = Object.entries(pick).flatMap(([itemId, q]) => Array(q).fill(ITEMS[itemId].plantId))
  const need = r ? r.inputs.reduce((n, i) => n + i.count, 0) : 0
  const valid = !!r && !!matchRecipe(r, units)
  const plants = Object.values(ITEMS).filter(i => i.kind === 'plant' && availableCount(s, i.itemId) > 0)
  const describe = (i: (typeof CRAFTS)[string]['inputs'][number]) =>
    `${i.plants ? i.plants.map(p => PLANTS[p].name).join('或') : i.tag === 'flowering' ? '开花植物' : '叶片植物'}×${i.count}${i.sameSeason ? '（同一季节）' : ''}`
  const make = async () => {
    if (!r || !valid) return
    setBusy(true)
    try {
      const inputs: Grant[] = Object.entries(pick).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }))
      await client.craftMake(r.recipeId, inputs)
      client.track('craft_make', { recipeId: r.recipeId })
      toast(`做好了「${r.name}」，可以摆进小院`); setPick({}); setRecipeId(null)
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title={r ? r.name : '手作台'} onClose={onClose}>
      {!r ? (
        <div className="col">
          {Object.values(CRAFTS).map(c => {
            const open = isRecipeOpen(c.recipeId, now)
            return (
              <button key={c.recipeId} className="item-tile wide" disabled={!open} onClick={() => setRecipeId(c.recipeId)} data-testid={`recipe-${c.recipeId}`}>
                <Img path={ITEMS[c.outputItemId].icon} eager /><span>{c.name}</span>
                <span className="tiny">{open ? c.inputs.map(describe).join(' + ') : '需要的植物还没开放'} · 已有 {s.inventory[c.outputItemId] ?? 0}</span>
              </button>
            )
          })}
          <p className="tiny muted">{CRAFT_RULES.materialNotice} 每种手作最多摆 {CRAFT_RULES.maxPlacedEach} 件到小院。</p>
        </div>
      ) : (
        <>
          <p className="tiny">需要：{r.inputs.map(describe).join(' + ')}（已选 {units.length}/{need}）</p>
          <div className="item-drawer">
            {plants.length === 0 && <span className="tiny muted">背包里没有可用的成熟植物（摆在小院里的不会被用掉）</span>}
            {plants.map(it => {
              const q = pick[it.itemId] ?? 0; const avail = availableCount(s, it.itemId)
              return (
                <button key={it.itemId} className={`item-tile${q ? ' on' : ''}`} data-testid={`pick-${it.itemId}`}
                  onClick={() => setPick(pk => ({ ...pk, [it.itemId]: q >= avail || units.length >= need ? 0 : q + 1 }))}>
                  <Img path={it.icon} eager /><span>{it.name}</span><span className="tiny">{q ? `选 ${q} · ` : ''}可用 {avail}</span>
                </button>
              )
            })}
          </div>
          <div className="real-card"><b>现实里也能做</b><p className="tiny">{r.realCard.steps}</p><p className="tiny muted">{r.realCard.ages}</p></div>
          <div className="row">
            <Btn small kind="ghost" onClick={() => { setRecipeId(null); setPick({}) }}>换一个</Btn>
            <Btn small disabled={!valid || busy} onClick={make} testId="make-craft">{busy ? '制作中…' : valid ? '制作' : '材料还不对'}</Btn>
          </div>
        </>
      )}
    </Sheet>
  )
}
