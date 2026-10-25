import { useState } from 'react'
import { copyText, detectInApp, gameLink } from './inApp'
import { useApp, useSnap } from './common'

const KEY = 'bcy.inAppBanner.closed'

/** A5 G1: in-app browsers keep their own storage; suggest a system browser and make copying the link one tap. */
export function InAppBanner() {
  const { toast, client } = useApp()
  const snap = useSnap()
  const app = detectInApp()
  const [closed, setClosed] = useState(() => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } })
  if (!app || closed) return null
  const where = snap.mode === 'demo' || client.authMode !== 'realname' ? '进度保存在当前浏览器里，换浏览器会看不到。' : '登录后进度跟着账号走。'
  const close = () => { try { sessionStorage.setItem(KEY, '1') } catch { /* private mode */ } setClosed(true) }
  return (
    <div className="inapp-banner" role="note" data-testid="inapp-banner">
      <span>正在{app.name}里打开。建议点右上角「···」选择在浏览器打开，保存图片更顺畅。{where}</span>
      <div className="row">
        <button className="btn btn-soft btn-sm" onClick={async () => toast(await copyText(gameLink()) ? '链接已复制，可粘贴到浏览器打开' : '复制失败，请长按地址栏复制')} data-testid="inapp-copy">复制链接</button>
        <button className="btn btn-ghost btn-sm" onClick={close} aria-label="关闭提示">知道了</button>
      </div>
    </div>
  )
}
