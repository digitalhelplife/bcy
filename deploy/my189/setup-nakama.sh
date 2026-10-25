#!/usr/bin/env bash
# Install / update the my189 Nakama deployment. Idempotent: secrets, the DB volume and the existing
# data are preserved; nakama.yml and docker-compose.yml are regenerated from .env on every run.
#
# Usage (on my189, as youdt with passwordless sudo):
#   bash setup-nakama.sh /path/to/bencaoyou.js
set -euo pipefail

ROOT=${ROOT:-/home/youdt/bencaoyou}
MODULE=${1:-$ROOT/modules/bencaoyou.js}
ENVF=$ROOT/.env
FRONTEND_ENVF=$ROOT/frontend.env
CONSOLE_PWFILE=$ROOT/console-password.txt
mkdir -p "$ROOT/modules" "$ROOT/data"

umask 077
if [ ! -f "$ENVF" ]; then
  DB_PASSWORD=$(openssl rand -hex 24)
  NAKAMA_SERVER_KEY=$(openssl rand -hex 32)
  SESSION_ENCRYPTION_KEY=$(openssl rand -hex 32)
  REFRESH_ENCRYPTION_KEY=$(openssl rand -hex 32)
  NAKAMA_CONSOLE_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 20)
  BCY_AUTH_SECRET=$(openssl rand -hex 32)
  cat > "$ENVF" <<EOF
DB_PASSWORD=$DB_PASSWORD
NAKAMA_SERVER_KEY=$NAKAMA_SERVER_KEY
SESSION_ENCRYPTION_KEY=$SESSION_ENCRYPTION_KEY
REFRESH_ENCRYPTION_KEY=$REFRESH_ENCRYPTION_KEY
NAKAMA_CONSOLE_PASSWORD=$NAKAMA_CONSOLE_PASSWORD
BCY_AUTH_SECRET=$BCY_AUTH_SECRET
EOF
  printf 'Nakama console: https://bencaoyou.tryliang.me/console/\nusername: admin\npassword: %s\n' "$NAKAMA_CONSOLE_PASSWORD" > "$CONSOLE_PWFILE"
fi
chmod 600 "$ENVF" 2>/dev/null || true
set -a
# shellcheck disable=SC1090
. "$ENVF"
set +a
if [ ! -f "$CONSOLE_PWFILE" ]; then
  printf 'Nakama console: https://bencaoyou.tryliang.me/console/\nusername: admin\npassword: %s\n' "${NAKAMA_CONSOLE_PASSWORD:-}" > "$CONSOLE_PWFILE"
fi
chmod 600 "$CONSOLE_PWFILE" 2>/dev/null || true

test -s "$MODULE" || { echo "missing Nakama module: $MODULE" >&2; exit 2; }
if [ "$MODULE" != "$ROOT/modules/bencaoyou.js" ]; then
  install -m 644 "$MODULE" "$ROOT/modules/bencaoyou.js"
else
  chmod 644 "$ROOT/modules/bencaoyou.js"
fi

cat > "$ROOT/nakama.yml" <<EOF
name: bencaoyou
logger:
  level: "INFO"
database:
  # Nakama takes the full DSN in database.address (user:password@host:port/dbname).
  address:
    - "nakama:${DB_PASSWORD}@postgres:5432/nakama"
runtime:
  path: "/nakama/data/modules"
  js_entrypoint: "bencaoyou.js"
  env:
    - "BCY_AUTH_MODE=device"
    - "BCY_AUTH_URL=http://127.0.0.1:7360"
    - "BCY_AUTH_SECRET=${BCY_AUTH_SECRET}"
    - "BCY_MIN_CLIENT_BUILD=2.3.0"
session:
  token_expiry_sec: 900
  refresh_token_expiry_sec: 604800
  encryption_key: "${SESSION_ENCRYPTION_KEY}"
  refresh_encryption_key: "${REFRESH_ENCRYPTION_KEY}"
socket:
  server_key: "${NAKAMA_SERVER_KEY}"
console:
  username: "admin"
  password: "${NAKAMA_CONSOLE_PASSWORD}"
EOF
chmod 600 "$ROOT/nakama.yml"

cat > "$FRONTEND_ENVF" <<EOF
VITE_NAKAMA_HOST=bencaoyou.tryliang.me
VITE_NAKAMA_PORT=443
VITE_NAKAMA_SSL=true
VITE_NAKAMA_SERVER_KEY=${NAKAMA_SERVER_KEY}
EOF
chmod 600 "$FRONTEND_ENVF"

install -m 644 "$(dirname "$0")/docker-compose.yml" "$ROOT/docker-compose.yml"

cd "$ROOT"
sudo -n docker compose up -d --remove-orphans
# A bind-mounted nakama.yml is read at process start; restart so config changes take effect.
sudo -n docker compose restart nakama >/dev/null
for i in $(seq 1 45); do
  if curl -fsS --max-time 3 http://127.0.0.1:7350/healthcheck >/dev/null 2>&1; then
    echo "NAKAMA_HEALTHY"
    break
  fi
  sleep 2
done
if ! curl -fsS --max-time 3 http://127.0.0.1:7350/healthcheck >/dev/null 2>&1; then
  echo "NAKAMA_NOT_HEALTHY" >&2
  sudo -n docker compose logs --tail=80 nakama >&2 || true
  exit 1
fi
echo "FRONTEND_ENV=$FRONTEND_ENVF"
echo "CONSOLE_PASSWORD_FILE=$CONSOLE_PWFILE"
sudo -n docker compose ps
sudo -n docker compose logs --tail=25 nakama | grep -E "bencao|Registered|RPC|error|fatal" || true
