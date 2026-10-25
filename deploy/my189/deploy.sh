#!/usr/bin/env bash
# Deploy 本草小游记·成都篇 to my189: Nakama 3.41.0 + PostgreSQL (Docker) and the static web build
# under Nginx at https://bencaoyou.tryliang.me. Run from the project root.
#
# The script never prints secrets. It fetches the server-generated client key into
# .env.production.local (gitignored), rebuilds the frontend, then uploads dist/.
set -euo pipefail

HOST=${DEPLOY_HOST:-my189}
SSH_OPTS=${SSH_OPTS:--o BatchMode=yes -o ConnectTimeout=15 -o ControlPath=/tmp/my189.sock}
WEB_DIR=/home/youdt/bencaoyou-web
REMOTE=/home/youdt/bencaoyou

echo "[1/8] build Nakama module"
pnpm build:nakama

echo "[2/8] upload module + installer"
scp $SSH_OPTS backend/nakama/build/bencaoyou.js "$HOST:/tmp/bencaoyou.js"
scp $SSH_OPTS deploy/my189/setup-nakama.sh deploy/my189/docker-compose.yml "$HOST:/tmp/"
ssh $SSH_OPTS "$HOST" 'bash /tmp/setup-nakama.sh /tmp/bencaoyou.js' | tail -40

echo "[3/8] fetch server-generated frontend env"
scp $SSH_OPTS "$HOST:$REMOTE/frontend.env" /tmp/bencaoyou-frontend.env
{
  cat /tmp/bencaoyou-frontend.env
  echo 'VITE_RELEASE_STAGE=S0'
} > .env.production.local
chmod 600 .env.production.local
rm -f /tmp/bencaoyou-frontend.env

echo "[4/8] build frontend"
AUTH_MODE=device VITE_RELEASE_STAGE=S0 pnpm run manus:build-source
node --input-type=module -e "import { assembleThreejsShareSite } from './scripts/manus-game-sharing/metadata.mjs'; assembleThreejsShareSite(process.cwd(), 'dist', { publicationOrigin: 'https://bencaoyou.tryliang.me', projectTitle: '本草小游记·成都篇' })"

echo "[5/8] upload static build"
tar -C dist -czf /tmp/bencaoyou-web.tgz .
scp $SSH_OPTS /tmp/bencaoyou-web.tgz "$HOST:/tmp/bencaoyou-web.tgz"
ssh $SSH_OPTS "$HOST" "set -e
  rm -rf $WEB_DIR.new && mkdir -p $WEB_DIR.new
  tar -C $WEB_DIR.new -xzf /tmp/bencaoyou-web.tgz
  chmod -R a+rX $WEB_DIR.new
  rm -rf $WEB_DIR.prev; [ -d $WEB_DIR ] && mv $WEB_DIR $WEB_DIR.prev
  mv $WEB_DIR.new $WEB_DIR
  rm -f /tmp/bencaoyou-web.tgz"

echo "[6/8] install Nginx vhost"
if ssh $SSH_OPTS "$HOST" 'sudo -n test -f /etc/letsencrypt/live/bencaoyou.tryliang.me/fullchain.pem'; then
  # Certificate already exists: install the HTTPS vhost directly to avoid a brief 443 outage.
  scp $SSH_OPTS deploy/my189/bencaoyou.tryliang.me.conf "$HOST:/tmp/bencaoyou.tryliang.me.conf"
  ssh $SSH_OPTS "$HOST" 'set -e
    sudo -n mkdir -p /www/server/panel/vhost/acme
    sudo -n install -m 644 /tmp/bencaoyou.tryliang.me.conf /www/server/panel/vhost/nginx/bencaoyou.tryliang.me.conf
    sudo -n nginx -t
    sudo -n nginx -s reload
    echo NGINX_RELOADED'
else
  # First deploy: serve the ACME challenge over HTTP, issue the certificate, then install HTTPS.
  scp $SSH_OPTS deploy/my189/nginx-http-only.conf "$HOST:/tmp/bencaoyou-http-only.conf"
  ssh $SSH_OPTS "$HOST" 'set -e
    sudo -n mkdir -p /www/server/panel/vhost/acme
    sudo -n install -m 644 /tmp/bencaoyou-http-only.conf /www/server/panel/vhost/nginx/bencaoyou.tryliang.me.conf
    sudo -n nginx -t
    sudo -n nginx -s reload'
  ssh $SSH_OPTS "$HOST" 'sudo -n certbot certonly --webroot -w /www/server/panel/vhost/acme -d bencaoyou.tryliang.me --non-interactive --agree-tos --register-unsafely-without-email' | tail -30
  scp $SSH_OPTS deploy/my189/bencaoyou.tryliang.me.conf "$HOST:/tmp/bencaoyou.tryliang.me.conf"
  ssh $SSH_OPTS "$HOST" 'set -e
    sudo -n install -m 644 /tmp/bencaoyou.tryliang.me.conf /www/server/panel/vhost/nginx/bencaoyou.tryliang.me.conf
    sudo -n nginx -t
    sudo -n nginx -s reload
    echo NGINX_RELOADED'
fi

echo "[7/8] certificate check"
ssh $SSH_OPTS "$HOST" 'sudo -n test -f /etc/letsencrypt/live/bencaoyou.tryliang.me/fullchain.pem && echo CERT_OK'

echo "[8/8] verify"
curl -fsS --max-time 15 https://bencaoyou.tryliang.me/ -o /tmp/bencaoyou-index.html
curl -fsS --max-time 15 https://bencaoyou.tryliang.me/healthcheck
echo
head -c 200 /tmp/bencaoyou-index.html; echo
echo "DEPLOY_OK https://bencaoyou.tryliang.me/"
