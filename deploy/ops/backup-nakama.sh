#!/usr/bin/env bash
# Daily Nakama PostgreSQL backup (doc 08 §8.3: RPO <= 24h).
# - Reads the DSN from ~/nakama/nakama.yml (never prints it).
# - pg_dump custom format -> ~/backups/nakama/nakama-YYYYmmdd-HHMM.dump, mode 600.
# - Verifies the archive with pg_restore --list; keeps 14 days.
# - With --drill: restores the newest dump into a scratch database, checks row counts, drops it.
set -euo pipefail
umask 077
DIR=${BACKUP_DIR:-$HOME/backups/nakama}
KEEP_DAYS=${KEEP_DAYS:-14}
LOG=$DIR/backup.log
mkdir -p "$DIR"
log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }

DSN=$(grep -A2 '^database:' "$HOME/nakama/nakama.yml" | grep -oE '"[^"]+@[^"]+"' | head -1 | tr -d '"')
[[ -n $DSN ]] || { log "FAIL no DSN in nakama.yml"; exit 2; }
DSN="postgresql://${DSN%%\?*}"   # user:pass@host:port/db
export PGCONNECT_TIMEOUT=10

if [[ ${1:-} == --drill ]]; then
  latest=$(ls -1t "$DIR"/nakama-*.dump 2>/dev/null | head -1)
  [[ -n $latest ]] || { log "DRILL FAIL no dump"; exit 3; }
  scratch=nakama_restore_drill
  t0=$(date +%s)
  sudo -u postgres dropdb --if-exists "$scratch"
  sudo -u postgres createdb "$scratch"
  # Dumps are mode 600 owned by this user; feed via stdin so the postgres role never needs file access.
  if ! sudo -u postgres pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch" < "$latest" 2>>"$LOG"; then
    sudo -u postgres dropdb --if-exists "$scratch"; log "DRILL FAIL pg_restore"; exit 4
  fi
  live=$(psql "$DSN" -Atc "select count(*) from storage where collection like 'game\_%'")
  rest=$(sudo -u postgres psql -d "$scratch" -Atc "select count(*) from storage where collection like 'game\_%'")
  users=$(sudo -u postgres psql -d "$scratch" -Atc "select count(*) from users")
  sudo -u postgres dropdb "$scratch"
  [[ $rest -gt 0 ]] || { log "DRILL FAIL restored 0 rows"; exit 5; }
  log "DRILL OK file=$(basename "$latest") restored_game_rows=$rest live_rows_now=$live users=$users rto_seconds=$(( $(date +%s) - t0 ))"
  exit 0
fi

out=$DIR/nakama-$(date +%Y%m%d-%H%M).dump
pg_dump "$DSN" -Fc -Z 6 -f "$out.part"
pg_restore --list "$out.part" > /dev/null
mv "$out.part" "$out"
chmod 600 "$out"
find "$DIR" -name 'nakama-*.dump' -mtime +"$KEEP_DAYS" -delete
log "OK $(basename "$out") $(du -h "$out" | cut -f1) kept=$(ls -1 "$DIR"/nakama-*.dump | wc -l)"
