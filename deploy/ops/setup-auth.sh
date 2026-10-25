#!/usr/bin/env bash
# Install / update bencao-auth on the game server. Idempotent: secrets and DB are created only once.
# Usage (on the server, as youdt with sudo):  bash setup-auth.sh <realname|device> /tmp/bencao-auth.mjs
# Realname on/off and the minor rule are RUNTIME config edited at https://<host>/admin/ (stored in the auth DB).
# <realname|device> only sets Nakama's BCY_AUTH_MODE fallback, used if the auth service has never answered
# (default realname = fail closed). AUTH_PUBLIC_MODE in $ENVF is no longer read.
set -euo pipefail
MODE=${1:-realname}
BUNDLE=${2:-/tmp/bencao-auth.mjs}
[[ "$MODE" == realname || "$MODE" == device ]] || { echo "mode must be realname|device"; exit 2; }
ENVF=/etc/bencao-auth/env
APPDIR=/home/youdt/bencao-auth
NAKAMA_YML=/home/youdt/nakama/nakama.yml

# 1. database + role (password generated once and kept only in $ENVF)
sudo install -d -m 750 -o root -g youdt /etc/bencao-auth
if ! sudo test -f "$ENVF"; then
  DBPW=$(openssl rand -hex 24)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin
  if not exists (select from pg_roles where rolname='bencao_auth') then create role bencao_auth login password '$DBPW';
  else alter role bencao_auth password '$DBPW'; end if;
end \$\$;
SQL
  sudo -u postgres psql -Atc "select 1 from pg_database where datname='bencao_auth'" | grep -q 1 || sudo -u postgres createdb -O bencao_auth bencao_auth
  sudo -u postgres psql -q -c "revoke all on database bencao_auth from public"
  sudo tee "$ENVF" >/dev/null <<EOF
# bencao-auth secrets — generated $(date -Iseconds). Never commit, never print.
AUTH_ENV=staging
AUTH_PUBLIC_MODE=$MODE
AUTH_PORT=7360
AUTH_DATABASE_URL=postgres://bencao_auth:$DBPW@127.0.0.1:5432/bencao_auth
AUTH_DATA_KEY=$(openssl rand -base64 32)
AUTH_LOOKUP_PEPPER=$(openssl rand -base64 32)
AUTH_TICKET_KEY=$(openssl rand -base64 32)
AUTH_INTERNAL_SECRET=$(openssl rand -hex 32)
AUTH_SMS_PROVIDER=mock
AUTH_REALNAME_PROVIDER=mock
AUTH_NAKAMA_URL=http://127.0.0.1:7350
EOF
  sudo chown root:youdt "$ENVF"; sudo chmod 640 "$ENVF"
  echo "created $ENVF and database bencao_auth"
else
  sudo sed -i "s/^AUTH_PUBLIC_MODE=.*/AUTH_PUBLIC_MODE=$MODE/" "$ENVF"
fi

# 2. application bundle
install -d -m 750 "$APPDIR"
install -m 640 "$BUNDLE" "$APPDIR/bencao-auth.mjs"

# 2b. admin console password — created once. Only the scrypt hash goes into $ENVF; the plaintext is written to an
#     owner-only file for the operator and is never echoed. Rotate: delete the hash line and the file, re-run.
PWFILE=/home/youdt/bencao-admin-password.txt
if ! sudo grep -q '^AUTH_ADMIN_PASSWORD_HASH=' "$ENVF"; then
  ADMIN_PW=$(openssl rand -base64 33 | tr -dc 'A-Za-z0-9' | head -c 20)
  HASH=$(printf '%s' "$ADMIN_PW" | node "$APPDIR/bencao-auth.mjs" hash-password)
  [[ "$HASH" == scrypt\$* ]] || { echo "admin password hashing failed"; exit 3; }
  echo "AUTH_ADMIN_PASSWORD_HASH=$HASH" | sudo tee -a "$ENVF" >/dev/null
  ( umask 077; printf '本草小游记 合规后台\n地址: https://ex-game.tryliang.me/admin/\n管理员密码: %s\n生成时间: %s\n' "$ADMIN_PW" "$(date -Iseconds)" > "$PWFILE" )
  unset ADMIN_PW
  echo "admin console password created → $PWFILE (mode 600, not printed)"
fi

# 3. systemd unit (loopback only, hardened)
sudo tee /etc/systemd/system/bencao-auth.service >/dev/null <<'UNIT'
[Unit]
Description=bencao-auth (phone login, realname, anti-addiction) for 本草小游记
After=network.target postgresql.service
Before=nakama.service

[Service]
User=youdt
Group=youdt
EnvironmentFile=/etc/bencao-auth/env
ExecStart=/usr/bin/env node /home/youdt/bencao-auth/bencao-auth.mjs
Restart=always
RestartSec=3
MemoryMax=192M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadOnlyPaths=/home/youdt/bencao-auth
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable -q bencao-auth
sudo systemctl restart bencao-auth

# 4. Nakama runtime env (secret copied from $ENVF; nakama.yml is 600 youdt)
SECRET=$(sudo grep '^AUTH_INTERNAL_SECRET=' "$ENVF" | cut -d= -f2)
cp -n "$NAKAMA_YML" "$NAKAMA_YML.bak-before-auth" || true
python3 - "$NAKAMA_YML" "$MODE" "$SECRET" <<'PY'
import re, sys
path, mode, secret = sys.argv[1:4]
s = open(path).read()
want = {'BCY_AUTH_MODE': mode, 'BCY_AUTH_URL': 'http://127.0.0.1:7360', 'BCY_AUTH_SECRET': secret}
# Update only our three keys in place; every other env entry (e.g. BCY_MIN_CLIENT_BUILD) is preserved.
m = re.search(r'(runtime:\n(?:[ \t]+[^\n]*\n)*?)  env:\n((?:    - "[^\n]*"\n)*)', s)
if m:
    lines = re.findall(r'    - "([^"\n]*)"\n', m.group(2))
    kept = [l for l in lines if l.split('=', 1)[0] not in want]
    block = '  env:\n' + ''.join(f'    - "{k}={v}"\n' for k, v in want.items()) + ''.join(f'    - "{l}"\n' for l in kept)
    s = s[:m.start(2) - len('  env:\n')] + block + s[m.end(2):]
else:
    s = s.replace('runtime:\n', 'runtime:\n  env:\n' + ''.join(f'    - "{k}={v}"\n' for k, v in want.items()), 1)
open(path, 'w').write(s)
PY
chmod 600 "$NAKAMA_YML"
for i in $(seq 1 20); do curl -fsS -m 2 http://127.0.0.1:7360/auth/healthz >/dev/null 2>&1 && break; sleep 0.5; done
curl -fsS -m 3 http://127.0.0.1:7360/auth/config; echo
sudo systemctl restart nakama
sleep 4
systemctl is-active bencao-auth nakama
sudo journalctl -u nakama --since "-20s" --no-pager -o cat | grep -o '"msg":"[^"]*bencao auth[^"]*"\|"msg":"[^"]*BCY_AUTH[^"]*"\|"level":"error"[^}]*' | head -5 || true
