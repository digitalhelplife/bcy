import type { LevelId, PaletteId, PlantId, PlotId, SceneId, TermId } from './types'
import plantsJson from '../../content/plants.json'
import setsJson from '../../content/sets.json'
import craftsJson from '../../content/crafts.json'
import visitorsJson from '../../content/visitors.json'
import termsJson from '../../content/solar_terms.json'
import complianceJson from '../../content/compliance.json'

// Single content package for chengdu_v1. The server owns authoritative rewards/answers; this
// module is built from the same package so the local demo server and the client agree.
export const CONTENT_PROFILE = 'chengdu_v1' as const
export const CONFIG_VERSION = 'chengdu_content_v1'
export const CLIENT_BUILD = '2.3.0'
export const WORLD = { width: 1080, height: 1920 } as const

export const RULES = {
  growMs: 300_000,
  runTtlMs: 1_800_000,
  dailyRepeatLimit: 3,
  runStartPerMinute: 6,
  maxPlacements: 80,
  gardenWidth: 8,
  gardenHeight: 10,
  dragThresholdCss: 8,
  snapRatio: 0.2,
  maxTitleCodepoints: 30,
} as const

// import.meta.env is absent inside the Nakama runtime bundle; the server never builds asset URLs.
const BASE: string = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/'
export const asset = (path: string): string => `${BASE}assets/${path}.webp`

export type HitArea = { x: number; y: number; r: number }
export type FindTarget = {
  targetId: string; label: string; hint: string; hit: HitArea
  // Overlay texture drawn on the background (null when the landmark is painted into the map itself).
  texture: string | null; size?: { w: number; h: number }; fictional: boolean
}
export type FogConfig = {
  texture: string; coversTargetId: string; start: { x: number; y: number }
  size: { w: number; h: number }; gate: 'fog_revealed'
}

export type SceneDef = {
  sceneId: SceneId; displayName: string; regionLabel: string; scope: string
  background: string; thumb: string; puzzleArt: string
  findLevel: LevelId; puzzleLevel: LevelId
  map: { x: number; y: number }
  targets: FindTarget[]; fog: FogConfig | null
  puzzle: { columns: number; rows: number }
  story: { id: string; title: string; text: string }
  factNote: string
}

// Dujiangyan hotspots are calibrated on the approved satellite-referenced map-style redraw
// (1440x2560 source → 1080x1920 world). Landmarks are painted into the map; no detached sprites.
export const SCENES: Record<SceneId, SceneDef> = {
  dujiangyan: {
    sceneId: 'dujiangyan', displayName: '都江堰水利工程', regionLabel: '成都·都江堰市', scope: '渠首写意场景',
    background: 'scenes/scene_dujiangyan_bg', thumb: 'scenes/scene_dujiangyan_thumb', puzzleArt: 'puzzles/puzzle_dujiangyan_art',
    findLevel: 'dujiangyan_find', puzzleLevel: 'dujiangyan_puzzle',
    map: { x: 0.311, y: 0.307 },
    targets: [
      { targetId: 'target_yuzui', label: '鱼嘴分水尖', hint: '岷江在长堤上游尖端一分为二', hit: { x: 362, y: 356, r: 78 }, texture: null, fictional: false },
      { targetId: 'target_feishayan', label: '飞沙堰低堰', hint: '内江与外江之间的低堰，泄洪排沙', hit: { x: 500, y: 812, r: 66 }, texture: null, fictional: false },
      { targetId: 'target_baopingkou', label: '宝瓶口', hint: '离堆旁的狭窄进水口，先拨开云雾', hit: { x: 602, y: 772, r: 62 }, texture: null, fictional: false },
    ],
    fog: { texture: 'effects/fog_overlay', coversTargetId: 'target_baopingkou', start: { x: 610, y: 770 }, size: { w: 470, h: 178 }, gate: 'fog_revealed' },
    puzzle: { columns: 2, rows: 2 },
    story: {
      id: 'story_dujiangyan', title: '都江堰·分水与引水',
      text: '岷江在鱼嘴被分成内江和外江；飞沙堰在洪水时把多余的水和泥沙排回外江；宝瓶口把内江水引向成都平原。三处工程彼此配合，至今仍在运行。',
    },
    factNote: '地标关系参考公开卫星影像与成都市政府景区资料；画面为原创写意改编，不是测绘地图或导航图。',
  },
  qingcheng: {
    sceneId: 'qingcheng', displayName: '青城山·前山', regionLabel: '成都·都江堰市', scope: '前山写意场景',
    background: 'scenes/scene_qingcheng_bg', thumb: 'scenes/scene_qingcheng_thumb', puzzleArt: 'puzzles/puzzle_qingcheng_art',
    findLevel: 'qingcheng_find', puzzleLevel: 'qingcheng_puzzle',
    map: { x: 0.704, y: 0.495 },
    targets: [
      { targetId: 'target_jianfu_eave', label: '建福宫檐角', hint: '山门附近的飞檐', hit: { x: 259, y: 768, r: 120 }, texture: 'targets/target_jianfu_eave', size: { w: 335, h: 323 }, fictional: false },
      { targetId: 'target_cloud_plaque', label: '原创云纹牌', hint: '林间挂着的一块原创装饰牌', hit: { x: 724, y: 1114, r: 90 }, texture: 'targets/target_cloud_plaque', size: { w: 113, h: 329 }, fictional: true },
      { targetId: 'target_paper_boat', label: '原创纸舟', hint: '湖面上漂着的一只原创纸舟', hit: { x: 702, y: 1478, r: 84 }, texture: 'targets/target_paper_boat', size: { w: 194, h: 110 }, fictional: true },
    ],
    fog: null,
    puzzle: { columns: 2, rows: 3 },
    story: {
      id: 'story_qingcheng', title: '青城山·前山林间',
      text: '青城山前山林木葱郁，建福宫、天师洞、上清宫与月城湖是常见的前山地标。游戏里的云纹牌与纸舟是原创装饰，不是景区现存实物。',
    },
    factNote: '青城山前山地标参考成都市政府景区资料；云纹牌、纸舟为虚构道具。',
  },
  jiezi: {
    sceneId: 'jiezi', displayName: '街子古镇', regionLabel: '成都·崇州市街子镇', scope: '古镇写意场景',
    background: 'scenes/scene_jiezi_bg', thumb: 'scenes/scene_jiezi_thumb', puzzleArt: 'puzzles/puzzle_jiezi_art',
    findLevel: 'jiezi_find', puzzleLevel: 'jiezi_puzzle',
    map: { x: 0.38, y: 0.696 },
    targets: [
      { targetId: 'target_ziku_bell', label: '字库塔檐铃', hint: '字库塔檐下的小铃', hit: { x: 691, y: 672, r: 80 }, texture: 'targets/target_ziku_bell', size: { w: 92, h: 176 }, fictional: false },
      { targetId: 'target_ginkgo_leaf', label: '银杏落叶', hint: '石板路上的一片金色银杏叶', hit: { x: 421, y: 1382, r: 70 }, texture: 'targets/target_ginkgo_leaf', size: { w: 81, h: 78 }, fictional: false },
      { targetId: 'target_old_door', label: '古街木门板', hint: '老街铺面的木门板', hit: { x: 238, y: 1114, r: 110 }, texture: 'targets/target_old_door', size: { w: 216, h: 325 }, fictional: false },
    ],
    fog: null,
    puzzle: { columns: 2, rows: 3 },
    story: {
      id: 'story_jiezi', title: '街子古镇·字库塔与银杏',
      text: '街子古镇的字库塔旧时用来焚化写过字的纸张，寄托敬惜字纸的习俗；古街两旁的银杏到了秋天落满金叶。',
    },
    factNote: '字库塔与银杏参考成都市政府景区资料；不使用未核定桥名与真实店招。',
  },
}
export const SCENE_ORDER: SceneId[] = ['dujiangyan', 'qingcheng', 'jiezi']

export type LevelDef = {
  levelId: LevelId; sceneId: SceneId; kind: 'find' | 'puzzle'; name: string
  plantId: PlantId; decor: [string, string]
}
export const LEVELS: Record<LevelId, LevelDef> = {
  dujiangyan_find: { levelId: 'dujiangyan_find', sceneId: 'dujiangyan', kind: 'find', name: '渠首寻踪', plantId: 'mint', decor: ['decor_wood_planter', 'decor_clay_pot'] },
  dujiangyan_puzzle: { levelId: 'dujiangyan_puzzle', sceneId: 'dujiangyan', kind: 'puzzle', name: '渠首拼图', plantId: 'lotus', decor: ['decor_bench', 'decor_stone_table'] },
  qingcheng_find: { levelId: 'qingcheng_find', sceneId: 'qingcheng', kind: 'find', name: '前山寻踪', plantId: 'mugwort', decor: ['decor_bamboo_rack', 'decor_specimen_rack'] },
  qingcheng_puzzle: { levelId: 'qingcheng_puzzle', sceneId: 'qingcheng', kind: 'puzzle', name: '前山拼图', plantId: 'honeysuckle', decor: ['decor_lantern', 'decor_rock'] },
  jiezi_find: { levelId: 'jiezi_find', sceneId: 'jiezi', kind: 'find', name: '古镇寻踪', plantId: 'perilla', decor: ['decor_window', 'decor_sign'] },
  jiezi_puzzle: { levelId: 'jiezi_puzzle', sceneId: 'jiezi', kind: 'puzzle', name: '古镇拼图', plantId: 'chrysanthemum', decor: ['decor_path', 'decor_gate'] },
}
export const LEVEL_IDS = Object.keys(LEVELS) as LevelId[]

export const puzzlePieces = (levelId: LevelId) => {
  const scene = SCENES[LEVELS[levelId].sceneId]
  const { columns, rows } = scene.puzzle
  return Array.from({ length: columns * rows }, (_, i) => ({
    pieceId: `${scene.sceneId}_piece_${i}`, slotIndex: i, col: i % columns, row: Math.floor(i / columns),
  }))
}

export type KidSafety = 'toxic' | 'look_only' | 'unverified' | 'safe'
export type PlantDef = {
  plantId: PlantId; name: string; fullName: string; latinName: string; family: string
  termId: TermId; termName: string; termRelation: string; season: 'spring' | 'summer' | 'autumn' | 'winter'
  base: boolean; levelId: LevelId | null; kidSafety: KidSafety; kidSafetyNote: string; observeType: string
  flowering: boolean; leafy: boolean; natureChallenge: string; reviewStatus: 'pending' | 'approved'
}
export const PLANTS: Record<PlantId, PlantDef> = Object.fromEntries((plantsJson.plants as unknown as PlantDef[]).map(p => [p.plantId, p]))
export const PLANT_IDS = Object.keys(PLANTS) as PlantId[]
export const BASE_PLANT_IDS = PLANT_IDS.filter(id => PLANTS[id].base)
export const isPlantId = (v: unknown): v is PlantId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLANTS, v)
export const plantTexture = (id: PlantId, kind: 'mature' | 'seedling' | 'seed' | 'icon' | 'codex_detail') => `plants/plant_${id}_${kind}`

export type ItemKind = 'seed' | 'plant' | 'decor'
export type ItemDef = { itemId: string; kind: ItemKind; name: string; texture: string; icon: string; footprint: { w: number; h: number }; plantId?: PlantId }
const DECOR: [string, string, number, number][] = [
  ['decor_wood_planter', '木花槽', 2, 1], ['decor_clay_pot', '陶花盆', 1, 1],
  ['decor_bench', '长凳', 2, 1], ['decor_stone_table', '石桌', 2, 2],
  ['decor_bamboo_rack', '竹花架', 1, 2], ['decor_specimen_rack', '标本展示架', 1, 2],
  ['decor_lantern', '提灯', 1, 1], ['decor_rock', '小石景', 1, 1],
  ['decor_window', '景窗屏风', 2, 1], ['decor_sign', '路牌', 1, 1],
  ['decor_path', '石径模块', 1, 1], ['decor_gate', '院门', 2, 2],
]
export const ITEMS: Record<string, ItemDef> = {}
for (const [itemId, name, w, h] of DECOR) {
  ITEMS[itemId] = { itemId, kind: 'decor', name, texture: `decor/${itemId}`, icon: `decor/${itemId}_icon`, footprint: { w, h } }
}
for (const p of Object.values(PLANTS)) {
  ITEMS[`seed_${p.plantId}`] = { itemId: `seed_${p.plantId}`, kind: 'seed', name: `${p.name}种子`, texture: plantTexture(p.plantId, 'seed'), icon: plantTexture(p.plantId, 'seed'), footprint: { w: 1, h: 1 }, plantId: p.plantId }
  ITEMS[`plant_${p.plantId}`] = { itemId: `plant_${p.plantId}`, kind: 'plant', name: p.name, texture: plantTexture(p.plantId, 'mature'), icon: plantTexture(p.plantId, 'icon'), footprint: { w: 1, h: 1 }, plantId: p.plantId }
}
export type CraftInput = { tag?: 'flowering' | 'leafy'; plants?: PlantId[]; count: number; sameSeason?: boolean }
export type CraftDef = { recipeId: string; name: string; inputs: CraftInput[]; outputItemId: string; realCard: { steps: string; ages: string } }
export const CRAFTS: Record<string, CraftDef> = Object.fromEntries((craftsJson.items as unknown as CraftDef[]).map(c => [c.recipeId, c]))
export const CRAFT_RULES = { maxPlacedEach: craftsJson.maxPlacedEach as number, materialNotice: craftsJson.materialNotice as string }
for (const c of Object.values(CRAFTS)) {
  ITEMS[c.outputItemId] = { itemId: c.outputItemId, kind: 'decor', name: c.name, texture: `decor/${c.outputItemId}`, icon: `decor/${c.outputItemId}_icon`, footprint: { w: 1, h: 1 } }
}
export const DECOR_IDS = DECOR.map(d => d[0])
export const CRAFT_ITEM_IDS = Object.values(CRAFTS).map(c => c.outputItemId)
export const isPlaceable = (itemId: string) => ITEMS[itemId]?.kind === 'decor' || ITEMS[itemId]?.kind === 'plant'

export const PALETTES: Record<PaletteId, { paletteId: PaletteId; name: string; paper: string; ink: string; accent: string; wood: string; tint: number }> = {
  green: { paletteId: 'green', name: '青城青绿', paper: '#F6F0E4', ink: '#425B46', accent: '#6EAAA0', wood: '#BD925E', tint: 0xffffff },
  warm_wood: { paletteId: 'warm_wood', name: '川西暖木', paper: '#F7ECD9', ink: '#5B5141', accent: '#C3A46F', wood: '#AE7951', tint: 0xfff0dc },
}

export const PLOT_IDS: PlotId[] = ['plot_1', 'plot_2', 'plot_3', 'plot_4', 'plot_5', 'plot_6', 'plot_7', 'plot_8']
/** plot_7/plot_8 open when the codex has this many discovered plants (12 文档 §5). */
export const PLOT_UNLOCK: Partial<Record<PlotId, number>> = { plot_7: 12, plot_8: 18 }
// Garden world layout on the painted courtyard (1080x1920). Grid coordinates are logical only.
export const GARDEN_LAYOUT = {
  background: 'garden/garden_base_bg',
  origin: { x: 130, y: 500 }, cell: { w: 107.5, h: 95 },
  // plot_1..6 are painted into the courtyard; plot_7/8 are drawn by GardenScene on the paving below.
  plots: {
    plot_1: { x: 124, y: 1546 }, plot_2: { x: 290, y: 1546 }, plot_3: { x: 456, y: 1546 }, plot_4: { x: 622, y: 1546 },
    plot_5: { x: 788, y: 1546 }, plot_6: { x: 954, y: 1546 }, plot_7: { x: 373, y: 1702 }, plot_8: { x: 705, y: 1702 },
  } as Record<PlotId, { x: number; y: number }>,
  paintedPlots: 6,
}

export const STORIES: Record<string, { title: string; text: string }> = {
  ...Object.fromEntries(Object.values(SCENES).map(s => [s.story.id, { title: s.story.title, text: s.story.text }])),
  story_finale: { title: '成都篇·旅程小结', text: '三处景点的六段旅程都已走完。你的小院里收着一路带回的苗圃植物和景点摆件，随时可以回来重玩、种植和重新布置。' },
  ...Object.fromEntries((setsJson.items as unknown as SetDef[]).map(x => [x.storyId, x.story])),
}
export type SetDef = { setId: string; name: string; plants: PlantId[]; items: string[]; storyId: string; story: { title: string; text: string } }
/** Sets unlock when every listed plant and item is placed in the saved garden (sets.json rule). */
export const SETS: Record<string, SetDef> = Object.fromEntries((setsJson.items as unknown as SetDef[]).map(x => [x.setId, x]))
export const SET_RULE = setsJson.rule as string
export type VisitorCondition = { minPlants?: number; items?: string[]; plants?: PlantId[]; anyPlants?: PlantId[]; anyCount?: number; minFloweringKinds?: number; minLeafy?: number }
export type VisitorDef = { visitorId: string; name: string; condition: VisitorCondition; childText: string; verification: string; verificationLevel: 'verified' | 'partial' | 'unverified'; texture: string }
export const VISITORS: Record<string, VisitorDef> = Object.fromEntries((visitorsJson.items as unknown as VisitorDef[]).map(v => [v.visitorId, v]))
export const VISITOR_RULES = { safetyNotice: visitorsJson.safetyNotice as string, dailyShowMax: visitorsJson.dailyShowMax as number }
export type TermDef = { termId: TermId; name: string; order: number; longitude: number; plantId: PlantId; phenology: string; challenge: string; challengeNotice: string; regionNotice: string }
export type TermOccurrence = { termId: TermId; at: string; atMs: number; verified: boolean }
export const TERMS: Record<TermId, TermDef> = Object.fromEntries((termsJson.terms as unknown as TermDef[]).map(t => [t.termId, t]))
export const TERM_IDS = (termsJson.terms as unknown as TermDef[]).sort((a, b) => a.order - b.order).map(t => t.termId)
export const TERM_OCCURRENCES: TermOccurrence[] = (termsJson.occurrences as unknown as TermOccurrence[]).slice().sort((a, b) => a.atMs - b.atMs)
export const CALENDAR_NOTE = termsJson.calendarNote as string
/**
 * Season opening config (06 v2.1): production opens only verified term occurrences that have passed,
 * plus `preopenTerms` upcoming verified terms after `epochMs`. `override:'all'` is S0/S1 only and the
 * production build gate (scripts/check-release.mjs) refuses it.
 */
/**
 * epochMs: launch day. backfillDays: at launch, verified terms that passed within this many days before launch are open
 * too (A5 G4: first week shows ≥12 plants instead of 6). The lower bound is fixed once launched, so the open set only grows.
 */
export const SEASON_CONFIG: { epochMs: number; preopenTerms: number; backfillDays: number; override: '' | 'all' } = { epochMs: Date.parse('2026-11-01T00:00:00+08:00'), preopenTerms: 2, backfillDays: 90, override: '' }
export const configureSeason = (c: Partial<typeof SEASON_CONFIG>) => { Object.assign(SEASON_CONFIG, c) }
export const QUIZ_TITLES: [number, string][] = [[6, '本草小学徒'], [12, '本草小行家'], [18, '节气观察员'], [24, '成都本草通']]
export const COMPLIANCE = complianceJson as unknown as {
  ageRating: { display: string; description: string; assessmentStatus: string }
  healthGameAdvice: string
  publicationInfo: { copyrightOwner: string; publishingServiceUnit: string; approvalNo: string; publicationNo: string }
  privacyPolicyVersion: string; userAgreementVersion: string; privacySummary: string[]
  nonOfficialStatement: string; plantDisclaimer: string; photoPrivacyNotice: string; trustPromise: string; feedbackChannel: string
}
export const SHARE = {
  canvas: { width: 1080, height: 1440 },
  templates: {
    share_scenic: { frame: 'share/share_scenic_template', defaultTitle: '在游戏里逛都江堰', name: '景点游记' },
    share_plant: { frame: 'share/share_plant_template', defaultTitle: '我的本草收藏页', name: '植物收藏' },
    share_garden: { frame: 'share/share_garden_template', defaultTitle: '我的川西小院', name: '小院作品' },
    // F25: a hand-journal page for one plant's four observation stages.
    share_nature: { frame: 'share/share_nature_template', defaultTitle: '我的自然笔记', name: '自然笔记' },
  },
  content: { x: 130, y: 300, w: 820, h: 770 },
  title: { x: 230, y: 138, w: 620, h: 116 },
  footer: { x: 180, y: 1170, w: 720, h: 145 },
  fixed: ['游戏画面·成都主题原创改编', '非景区官方产品'],
  plantSafety: '植物文化内容，不构成用药建议',
} as const
export type ShareTemplateId = keyof typeof SHARE.templates

export const TRIAL_NOTICE = '试玩进度与当前浏览器关联，清除站点数据或换浏览器后可能无法恢复。'
export const CONTENT_NOTICE = '游戏中的植物均来自虚拟苗圃奖励，不代表景区野生分布，不鼓励野外采摘；植物文化内容不构成用药建议。景点画面为成都主题原创改编，非景区官方产品。'
