#!/usr/bin/env bash
# Deploy 本草小游记 to ex-game.tryliang.me (frontend static + Nakama JS module).
# Usage: deploy/deploy.sh [auth|web|nakama|all]   (default all; AUTH_MODE=realname|device, default realname)
# Requires: ~/.ssh/oceankey, .env.production.local (VITE_NAKAMA_*), run from project root.
set -euo pipefail
HOST=${DEPLOY_HOST:-youdt@ex-game.tryliang.me}
KEY=${DEPLOY_KEY:-$HOME/.ssh/oceankey}
SSH="ssh -i $KEY -o BatchMode=yes $HOST"
WEB_DIR=/home/youdt/bencaoyou-web
what=${1:-all}

if [[ $what == auth || $what == all ]]; then
  node backend/auth/build.mjs
  scp -i "$KEY" -q backend/auth/build/bencao-auth.mjs deploy/ops/setup-auth.sh "$HOST:/tmp/"
  $SSH "bash /tmp/setup-auth.sh ${AUTH_MODE:-realname} /tmp/bencao-auth.mjs && rm -f /tmp/bencao-auth.mjs"
fi
if [[ $what == nakama || $what == all ]]; then
  node backend/nakama/build.mjs
  scp -i "$KEY" -q backend/nakama/build/bencaoyou.js "$HOST:/home/youdt/nakama/data/modules/bencaoyou.js.new"
  $SSH 'set -e; cd ~/nakama/data/modules; [ -f bencaoyou.js ] && cp bencaoyou.js bencaoyou.js.prev; mv bencaoyou.js.new bencaoyou.js
        grep -q js_entrypoint ~/nakama/nakama.yml || sed -i "/^runtime:/a\  js_entrypoint: \"bencaoyou.js\"" ~/nakama/nakama.yml
        # Pin the accepted minimum client build explicitly. Without it the server would default to its own build, so a
        # backend deploy would instantly refuse writes from pages still running the previous frontend. Only ever added
        # when missing — raise it by hand after the new frontend is live (README: 升级顺序).
        grep -q BCY_MIN_CLIENT_BUILD ~/nakama/nakama.yml || sed -i "/BCY_AUTH_MODE=/a\    - \"BCY_MIN_CLIENT_BUILD=${MIN_CLIENT_BUILD:-2.2.0}\"" ~/nakama/nakama.yml
        sudo systemctl restart nakama; sleep 4; systemctl is-active nakama
        sudo journalctl -u nakama --since "-20s" --no-pager | grep -c "Registered JavaScript runtime RPC" '
fi

if [[ $what == web || $what == all ]]; then
  # Release gate (scripts/release-gate.mjs) runs inside the build; it needs the auth mode the server runs with.
  AUTH_MODE=${AUTH_MODE:-realname} pnpm -s build
  # Link previews must point at the self-hosted domain, not the Manus sharing domain.
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://ex-game.tryliang.me}
  sed -i -E "s#https://[a-z0-9-]+\.manus\.game#${PUBLIC_ORIGIN}#g" dist/index.html
  tar -C dist -czf /tmp/bencaoyou-web.tgz .
  scp -i "$KEY" -q deploy/nginx/bencaoyou-security-headers.conf deploy/nginx/bencaoyou-ratelimit.conf "$HOST:/tmp/"
  scp -i "$KEY" -q /tmp/bencaoyou-web.tgz "$HOST:/tmp/bencaoyou-web.tgz"
  scp -i "$KEY" -q deploy/nginx-ex-game.conf "$HOST:/tmp/nginx-ex-game.conf"
  $SSH "set -e
    rm -rf $WEB_DIR.new && mkdir -p $WEB_DIR.new && tar -C $WEB_DIR.new -xzf /tmp/bencaoyou-web.tgz
    chmod -R a+rX $WEB_DIR.new
    rm -rf $WEB_DIR.prev; [ -d $WEB_DIR ] && mv $WEB_DIR $WEB_DIR.prev; mv $WEB_DIR.new $WEB_DIR
    CONF=/etc/nginx/sites-available/ex-game.tryliang.me.conf; [ -L /etc/nginx/sites-enabled/ex-game.tryliang.me.conf ] || CONF=/etc/nginx/sites-enabled/ex-game.tryliang.me.conf
    sudo cp -n \$CONF /home/youdt/nakama-deploy/nginx-ex-game.before-bencaoyou.conf || true
    sudo cp \$CONF /tmp/nginx-ex-game.rollback.conf
    sudo install -m 644 /tmp/bencaoyou-security-headers.conf /etc/nginx/snippets/bencaoyou-security-headers.conf
    sudo install -m 644 /tmp/bencaoyou-ratelimit.conf /etc/nginx/conf.d/bencaoyou-ratelimit.conf
    sudo cp /tmp/nginx-ex-game.conf \$CONF
    if sudo nginx -t 2>/tmp/nginx-t.log; then sudo systemctl reload nginx; echo NGINX_RELOADED; else cat /tmp/nginx-t.log; sudo cp /tmp/nginx-ex-game.rollback.conf \$CONF; echo NGINX_ROLLED_BACK; exit 1; fi"
fi
