import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) }
}

const MAX_BODY = 2 * 1024 * 1024

export async function readJson(req: IncomingMessage, allowed?: string[]): Promise<Record<string, unknown>> {
  const ct = String(req.headers['content-type'] || '').toLowerCase()
  if (!ct.startsWith('application/json')) throw new HttpError(415, 'INVALID_PAYLOAD', '请求格式错误')
  const body = await readBody(req, MAX_BODY)
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch { throw new HttpError(400, 'INVALID_PAYLOAD', '请求格式错误') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'INVALID_PAYLOAD', '请求格式错误')
  if (allowed) for (const k of Object.keys(parsed)) if (!allowed.includes(k)) throw new HttpError(400, 'INVALID_PAYLOAD', `未知字段：${k}`)
  return parsed as Record<string, unknown>
}

export async function readText(req: IncomingMessage, max = MAX_BODY): Promise<string> {
  return readBody(req, max)
}

async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > max) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', '请求过大')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const BASE_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

export function sendJson(res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
    ...extra,
  })
  res.end(body)
}

export function sendText(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': type, 'content-length': String(Buffer.byteLength(body)), ...extra })
  res.end(body)
}

export function sendError(res: ServerResponse, status: number, code: string, message: string, traceId?: string, details?: unknown) {
  sendJson(res, status, { ok: false, error: { code, message, traceId, ...(details !== undefined ? { details } : {}) } })
}

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real.trim()) return real.trim()
    const fwd = req.headers['x-forwarded-for']
    if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
}

/** Serve a file only if it resolves inside `baseDir`. Returns true when handled. */
export function serveStatic(res: ServerResponse, baseDir: string, relPath: string): boolean {
  const safe = normalize(decodeURIComponent(relPath)).replace(/^([/\\])+/, '')
  const target = resolve(join(baseDir, safe))
  const base = resolve(baseDir)
  if (target !== base && !target.startsWith(base + sep)) return false
  if (!existsSync(target) || !statSync(target).isFile()) return false
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    ...BASE_HEADERS,
    'content-type': type,
    'content-length': String(statSync(target).size),
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  })
  createReadStream(target).pipe(res)
  return true
}

export function securityHeaders(res: ServerResponse) {
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'")
  for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v)
}
