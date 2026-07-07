#!/bin/sh
# Runs inside the `pg-backup` sidecar (docker-compose.prod.yml). Loops
# forever: sleep, dump, prune. There is no external cron daemon — the loop
# lives entirely in this script so the sidecar needs nothing beyond the
# `postgres:17-alpine` image already pulled for the primary database (same
# PostgreSQL License; no new third-party dependency or image).
#
# Backup format: `pg_dump -Fc` (custom format). Chosen over plain SQL because
# it is compressed by default and restorable with `pg_restore`, including
# selective table/schema restores — see docs/data/backup-restore.md.
#
# Required env: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
# Optional env: BACKUP_INTERVAL_SECONDS (default 86400 = daily),
#               BACKUP_RETENTION_DAYS (default 14)
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

log() {
  echo "[pg-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
}

run_backup() {
  local ts dest tmp
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dest="$BACKUP_DIR/wivwav-${ts}.dump"
  tmp="${dest}.partial"

  log "starting backup -> $dest"
  # Dump to a .partial path first so a crash mid-dump never leaves a
  # truncated file with a "real" name for the restore drill or an operator
  # to pick up.
  if pg_dump -Fc --no-owner --no-privileges -f "$tmp"; then
    mv "$tmp" "$dest"
    log "backup complete: $dest ($(du -h "$dest" | cut -f1))"
  else
    log "backup FAILED — removing partial file"
    rm -f "$tmp"
    return 1
  fi
}

prune_old_backups() {
  log "pruning backups older than ${RETENTION_DAYS} days"
  find "$BACKUP_DIR" -maxdepth 1 -name 'wivwav-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
}

log "pg-backup sidecar started: interval=${INTERVAL_SECONDS}s retention=${RETENTION_DAYS}d dir=${BACKUP_DIR}"

while true; do
  run_backup || log "continuing after failed backup — next attempt in ${INTERVAL_SECONDS}s"
  prune_old_backups || true
  sleep "$INTERVAL_SECONDS"
done
