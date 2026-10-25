// A5 G1/G2: in-app browsers (小红书 / 微信 / QQ / 微博 / 抖音) often block downloads and system share,
// and keep their own storage, so progress there does not follow the player to Safari/Chrome.
export type InAppBrowser = { id: 'xhs' | 'wechat' | 'qq' | 'weibo' | 'douyin'; name: string }

const RULES: [RegExp, InAppBrowser][] = [
  [/xhsdiscover|xiaohongshu/i, { id: 'xhs', name: '小红书' }],
  [/MicroMessenger/i, { id: 'wechat', name: '微信' }],
  [/\bQQ\//i, { id: 'qq', name: 'QQ' }],
  [/Weibo/i, { id: 'weibo', name: '微博' }],
  [/aweme|BytedanceWebview|Douyin/i, { id: 'douyin', name: '抖音' }],
]

export function detectInApp(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): InAppBrowser | null {
  for (const [re, b] of RULES) if (re.test(ua)) return b
  return null
}

/** The canonical game link without query/hash (never leaks a session or test parameter). */
export const gameLink = () => `${location.origin}${location.pathname.replace(/index\.html$/, '')}`

export const SEARCH_PHRASE = '本草小游记 成都篇'

/** Clipboard API first; falls back to a hidden textarea + execCommand for older WebViews. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

export const blobToDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(new Error('图片读取失败'))
  r.readAsDataURL(b)
})
