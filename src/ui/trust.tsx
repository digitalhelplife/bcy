import { COMPLIANCE } from '../shared/content'

/** A5 G6: the trust promise as visible chips, not a footnote. Text comes from content/compliance.json. */
export function TrustChips() {
  const items = COMPLIANCE.trustPromise.split('·').map(t => t.trim()).filter(Boolean)
  return (
    <ul className="trust-chips" aria-label="我们的承诺" data-testid="trust-chips">
      {items.map(t => <li key={t}>{t}</li>)}
    </ul>
  )
}
