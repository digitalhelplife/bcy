#!/usr/bin/env bash
# Apply the admin schema and the read-only views. Idempotent.
# Requires a migration role (CREATE on the target schemas); the runtime role stays read-only.
set -euo pipefail
cd "$(dirname "$0")/../.."

: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL is required}"
: "${NAKAMA_DATABASE_URL:?NAKAMA_DATABASE_URL is required (migration credentials, not the read-only role)}"
: "${AUTH_DATABASE_URL:?AUTH_DATABASE_URL is required (migration credentials)}"

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/admin/sql/0001_admin.sql
psql "$NAKAMA_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/admin/sql/nakama_views.sql
psql "$AUTH_DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/admin/sql/auth_views.sql
node scripts/build-admin-snapshot.mjs
echo "[admin-migrate] schema, views and snapshot are up to date"
