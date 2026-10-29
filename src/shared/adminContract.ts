// Admin console contract shared by the browser and the admin service.
// The server is the source of truth: route handlers check `can(role, permission)`; the UI only hides controls.
// Keep this module dependency-free so it can be imported by the Vite bundle and the esbuild backend.

export type AdminRole = 'owner' | 'ops' | 'support' | 'reviewer' | 'viewer'

export const ADMIN_ROLES: AdminRole[] = ['owner', 'ops', 'support', 'reviewer', 'viewer']

export const ROLE_LABELS: Record<AdminRole, string> = {
  owner: '负责人',
  ops: '运营',
  support: '客服',
  reviewer: '内容审核',
  viewer: '只读',
}

export type Permission =
  | 'overview.view'
  | 'metrics.view'
  | 'metrics.export'
  | 'users.view'
  | 'users.phone'
  | 'feedback.view'
  | 'feedback.contact'
  | 'feedback.manage'
  | 'content.view'
  | 'config.view'
  | 'config.write'
  | 'audit.view'
  | 'promo.view'
  | 'promo.manage'
  | 'admin.manage'
  | 'environment.view'

const OPS: Permission[] = [
  'overview.view', 'metrics.view', 'metrics.export', 'users.view',
  'feedback.view', 'feedback.manage', 'content.view', 'config.view', 'audit.view', 'promo.view', 'promo.manage',
]
const SUPPORT: Permission[] = [
  'overview.view', 'users.view', 'users.phone', 'feedback.view', 'feedback.contact', 'feedback.manage',
]
const REVIEWER: Permission[] = ['overview.view', 'content.view']
const VIEWER: Permission[] = ['overview.view', 'metrics.view', 'content.view', 'audit.view']

export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  owner: [
    'overview.view', 'metrics.view', 'metrics.export', 'users.view', 'users.phone',
    'feedback.view', 'feedback.contact', 'feedback.manage', 'content.view', 'config.view', 'config.write',
    'audit.view', 'promo.view', 'promo.manage', 'admin.manage', 'environment.view',
  ],
  ops: OPS,
  support: SUPPORT,
  reviewer: REVIEWER,
  viewer: VIEWER,
}

export function can(role: AdminRole | null | undefined, permission: Permission): boolean {
  if (!role) return false
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export type SessionUser = {
  id: string
  username: string
  role: AdminRole
  totpEnabled: boolean
  environment: 'staging' | 'production'
  permissions: Permission[]
}

export type FeedbackStatus = 'NEW' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED'
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  NEW: '新', IN_PROGRESS: '处理中', RESOLVED: '已解决', ARCHIVED: '已归档',
}

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; traceId?: string } }
