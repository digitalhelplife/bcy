// A6-A1a: every image the offline trial needs (Dujiangyan find level + scenic journal). Used by scripts/build-trial.mjs.
import { SCENES, SHARE } from '../shared/content'
const sc = SCENES.dujiangyan
export const TRIAL_ASSETS: string[] = [
  sc.background, sc.thumb, ...sc.targets.flatMap(t => (t.texture ? [t.texture] : [])), ...(sc.fog ? [sc.fog.texture] : []),
  'effects/fx_target_ring', 'effects/fx_found_badge', 'effects/fx_sparkle',
  SHARE.templates.share_scenic.frame, 'brand/brand_wordmark',
]
