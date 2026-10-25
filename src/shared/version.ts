/** Numeric dotted build comparison ("2.10.0" > "2.9.3"). Non-numeric parts count as 0. */
export function cmpBuild(a: string, b: string): number {
  const pa = String(a || '0').split('.').map(x => parseInt(x, 10) || 0)
  const pb = String(b || '0').split('.').map(x => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}
