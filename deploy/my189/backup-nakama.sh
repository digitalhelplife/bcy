#!/usr/bin/env bash
# Daily PostgreSQL backup for the Docker-based my189 deployment.
# Writes a custom-format dump (mode 600), verifies it with pg_restore --list, keeps 14 days.
# Usage: ./backup-nakama.sh [--drill]
set -euo pipefail
ROOT=${ROOT:-/home/youdt/bencaoyou}
DIR=${BACKUP_DIR:-$ROOT/backups}
KEEP_DAYS=${KEEP_DAYS:-14}
COMPOSE="sudo -n docker compose -f $ROOT/docker-compose.yml"
mkdir -p "$DIR"
chmod 700 "$DIR"
umask 077

if [ "${1:-}" = "--drill" ]; then
  latest=$(ls -1t "$DIR"/nakama-*.dump 2>/dev/null | head -1)
  [ -n "$latest" ] || { echo "no dump to drill" >&2; exit 2; }
  # Verify the archive can be listed and contains the Nakama schema. A full restore drill is done on the old
  # ex-game host; here the archive integrity + table listing is the lightweight daily check.
  $COMPOSE exec -T postgres pg_restore --list < "$latest" | grep -q "TABLE public users" || { echo "drill failed: no users table" >&2; exit 3; }
  echo "DRILL_OK $(basename "$latest")"
  exit 0
fi

out="$DIR/nakama-$(date +%Y%m%d-%H%M).dump"
$COMPOSE exec -T postgres pg_dump -U nakama -d nakama -Fc > "$out.part"
$COMPOSE exec -T postgres pg_restore --list < "$out.part" >/dev/null
mv "$out.part" "$out"
chmod 600 "$out"
find "$DIR" -name 'nakama-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "BACKUP_OK $(basename "$out") $(du -h "$out" | cut -f1)"
