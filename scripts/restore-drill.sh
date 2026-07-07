#!/usr/bin/env bash
# Restore drill for docs/data/backup-restore.md (#667).
#
# Proves a PostgreSQL backup taken with the same pg_dump flags as
# docker/postgres-backup/backup.sh actually restores into a clean database
# and that the application-level invariants called out in #667's acceptance
# criteria hold afterward:
#   - listing/history row counts survive the round trip
#   - a vehicle-identity decision is present
#   - encrypted config is decryptable with the correct CONFIG_ENCRYPTION_SECRET
#     (and, as a negative control, NOT decryptable with the wrong one)
#
# Two modes:
#   1. Self-test (default, no args): spins up an ephemeral "source" Postgres
#      container, applies real Prisma migrations, seeds a minimal fixture
#      covering every invariant above, dumps it, restores the dump into a
#      second ephemeral "destination" container, and verifies. This is the
#      mode CI runs — it needs no pre-existing backup and proves the whole
#      pipeline (migrate -> seed -> dump -> restore -> verify) end to end.
#   2. `--dump <path>`: restores a real backup file (e.g. one pulled from the
#      `postgres_backups` volume) into a clean ephemeral container and runs
#      the same row-count/decrypt checks against whatever data the dump
#      contains. Use this to drill an actual production backup.
#
# Requires: docker, node, and (self-test mode only) pnpm with dependencies
# already installed (`pnpm install`) so `prisma migrate deploy` can run
# against packages/db/prisma/schema.prisma.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CRYPTO_CLI="$SCRIPT_DIR/restore-drill-crypto.mjs"

PG_IMAGE="postgres:17-alpine"
DB_USER="drill"
DB_PASSWORD="drill"
DB_NAME="wivwav_drill"
# PID + bash's $RANDOM + wall-clock second. Second-granularity timestamps
# alone collide too easily on a shared/self-hosted runner where two drills
# could start in the same second; $RANDOM adds enough entropy without
# relying on `date +%s%N`, which isn't portable (BSD/macOS date has no
# nanosecond field).
RUN_ID="$$-${RANDOM}-$(date +%s)"
SRC_CONTAINER="wivwav-restore-drill-src-${RUN_ID}"
DST_CONTAINER="wivwav-restore-drill-dst-${RUN_ID}"
WORKDIR="$(mktemp -d)"
DUMP_FILE="$WORKDIR/drill.dump"

DUMP_ARG=""
if [ "${1:-}" = "--dump" ]; then
  DUMP_ARG="${2:?--dump requires a path}"
  DUMP_FILE="$DUMP_ARG"
fi

CONFIG_ENCRYPTION_SECRET="${CONFIG_ENCRYPTION_SECRET:-$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")}"
FIXTURE_SECRET_PLAINTEXT="restore-drill-canary-value"

STARTED_AT=$SECONDS

log() { echo "[restore-drill] $*"; }
fail() { echo "[restore-drill] FAIL: $*" >&2; exit 1; }

cleanup() {
  docker rm -f "$SRC_CONTAINER" >/dev/null 2>&1 || true
  docker rm -f "$DST_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

# The official postgres:17-alpine entrypoint does two startup phases on a
# fresh volume: it runs initdb, briefly starts postgres on localhost only to
# execute init scripts, shuts that instance down, then does the real
# startup. `pg_isready` can succeed during that first, transient instance —
# right before it shuts down for the restart — so a single successful
# pg_isready is not sufficient and leaves a race where pg_restore connects
# just as the server is shutting down ("the database system is shutting
# down"). Both startup phases log "database system is ready to accept
# connections"; waiting for that line to appear twice in the container log
# reliably spans the restart window instead of racing it.
wait_for_postgres() {
  local container="$1"
  local ready_marker="database system is ready to accept connections"
  for _ in $(seq 1 120); do
    local ready_count
    ready_count="$(docker logs "$container" 2>&1 | grep -c "$ready_marker" || true)"
    if [ "${ready_count:-0}" -ge 2 ]; then
      return 0
    fi
    sleep 1
  done
  fail "$container did not complete its startup restart (fewer than two \"$ready_marker\" log lines) within 120s"
}

# Publishes to a Docker-assigned ephemeral host port (-p 0:5432) rather than
# relying on the container's internal IP, which Docker Desktop (macOS/Windows)
# does not route to directly — only published ports are host-reachable there.
start_container() {
  local name="$1"
  docker run -d --rm --name "$name" \
    -p 127.0.0.1::5432 \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASSWORD" \
    -e POSTGRES_DB="$DB_NAME" \
    "$PG_IMAGE" >/dev/null
  wait_for_postgres "$name"
}

host_port() {
  docker port "$1" 5432/tcp | head -1 | sed -E 's/.*:([0-9]+)$/\1/'
}

if [ -z "$DUMP_ARG" ]; then
  log "self-test mode: building a source database, seeding a fixture, and dumping it"
  start_container "$SRC_CONTAINER"

  SRC_PORT="$(host_port "$SRC_CONTAINER")"
  SRC_DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${SRC_PORT}/${DB_NAME}"

  log "applying Prisma migrations to the source database"
  (
    cd "$REPO_ROOT/packages/db"
    DATABASE_URL="$SRC_DATABASE_URL" pnpm exec prisma migrate deploy --schema prisma/schema.prisma
  ) || fail "prisma migrate deploy failed against the ephemeral source database"

  log "seeding a minimal fixture (source, listings, vehicle, history, identity decision, encrypted config)"
  FIXTURE_ENCRYPTED_VALUE="$(node "$CRYPTO_CLI" encrypt "$FIXTURE_SECRET_PLAINTEXT" "$CONFIG_ENCRYPTION_SECRET")"
  FIXTURE_HINT="${FIXTURE_SECRET_PLAINTEXT: -4}"

  docker exec -i "$SRC_CONTAINER" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" <<SQL
INSERT INTO sources (id, name, "baseUrl", "updatedAt")
VALUES ('drill-source-1', 'restore-drill-fixture-source', 'https://example.test', now());

INSERT INTO vehicle (id, make, model, year)
VALUES ('drill-vehicle-1', 'Toyota', 'Sienna', 2021);

INSERT INTO listings (id, "sourceId", "sourceUrl", "sourceRecordKey", make, model, year, condition, "sellerType", images, "listedAt", "updatedAt", "vehicleId")
VALUES
  ('drill-listing-a', 'drill-source-1', 'https://example.test/a', 'a-key', 'Toyota', 'Sienna', 2021, 'used', 'dealer', '{}', now(), now(), 'drill-vehicle-1'),
  ('drill-listing-b', 'drill-source-1', 'https://example.test/b', 'b-key', 'Toyota', 'Sienna', 2021, 'used', 'dealer', '{}', now(), now(), NULL);

INSERT INTO vehicle_identity_decision (id, "listingAId", "listingBId", "vehicleId", state, signals, "updatedAt")
VALUES ('drill-decision-1', 'drill-listing-a', 'drill-listing-b', 'drill-vehicle-1', 'verified', '{}'::jsonb, now());

INSERT INTO listing_price_history (id, "listingId", "priceCents")
VALUES ('drill-price-1', 'drill-listing-a', 32999);

INSERT INTO listing_mileage_history (id, "listingId", mileage)
VALUES ('drill-mileage-1', 'drill-listing-a', 45210);

INSERT INTO listing_conversion_history (id, "listingId", "conversionStatus", "wavFeatures")
VALUES ('drill-conversion-1', 'drill-listing-a', 'complete', '{}');

INSERT INTO config_entry (id, key, value, type, "encryptedValue", hint)
VALUES ('drill-config-1', 'restore-drill.canary', NULL, 'secret', '${FIXTURE_ENCRYPTED_VALUE}', '${FIXTURE_HINT}');
SQL

  log "dumping the source database (same pg_dump flags as docker/postgres-backup/backup.sh)"
  docker exec "$SRC_CONTAINER" pg_dump -Fc --no-owner --no-privileges -U "$DB_USER" -d "$DB_NAME" -f /tmp/drill.dump
  docker cp "$SRC_CONTAINER:/tmp/drill.dump" "$DUMP_FILE"
  docker rm -f "$SRC_CONTAINER" >/dev/null 2>&1 || true
else
  [ -f "$DUMP_FILE" ] || fail "dump file not found: $DUMP_FILE"
  log "real-backup mode: restoring $DUMP_FILE"
fi

log "restoring into a clean destination database"
start_container "$DST_CONTAINER"
docker cp "$DUMP_FILE" "$DST_CONTAINER:/tmp/drill.dump"
docker exec "$DST_CONTAINER" pg_restore --no-owner --no-privileges -U "$DB_USER" -d "$DB_NAME" /tmp/drill.dump \
  || fail "pg_restore failed"

psql_scalar() {
  docker exec "$DST_CONTAINER" psql -t -A -U "$DB_USER" -d "$DB_NAME" -c "$1" | tr -d '[:space:]'
}

log "verifying invariants"

PRICE_COUNT="$(psql_scalar 'SELECT count(*) FROM listing_price_history;')"
MILEAGE_COUNT="$(psql_scalar 'SELECT count(*) FROM listing_mileage_history;')"
CONVERSION_COUNT="$(psql_scalar 'SELECT count(*) FROM listing_conversion_history;')"
DECISION_COUNT="$(psql_scalar 'SELECT count(*) FROM vehicle_identity_decision;')"

[ "$PRICE_COUNT" -gt 0 ] || fail "listing_price_history is empty after restore"
[ "$MILEAGE_COUNT" -gt 0 ] || fail "listing_mileage_history is empty after restore"
[ "$CONVERSION_COUNT" -gt 0 ] || fail "listing_conversion_history is empty after restore"
[ "$DECISION_COUNT" -gt 0 ] || fail "vehicle_identity_decision is empty after restore"

log "  listing_price_history rows: $PRICE_COUNT"
log "  listing_mileage_history rows: $MILEAGE_COUNT"
log "  listing_conversion_history rows: $CONVERSION_COUNT"
log "  vehicle_identity_decision rows: $DECISION_COUNT"

ENCRYPTED_VALUE="$(psql_scalar "SELECT \"encryptedValue\" FROM config_entry WHERE type = 'secret' AND \"encryptedValue\" IS NOT NULL ORDER BY \"createdAt\" DESC LIMIT 1;")"
[ -n "$ENCRYPTED_VALUE" ] || fail "no decryptable secret config_entry row found after restore"

DECRYPTED="$(node "$CRYPTO_CLI" decrypt "$ENCRYPTED_VALUE" "$CONFIG_ENCRYPTION_SECRET")" \
  || fail "encrypted config did not decrypt with CONFIG_ENCRYPTION_SECRET"
log "  encrypted config decrypts with the correct secret"

if [ -z "$DUMP_ARG" ]; then
  [ "$DECRYPTED" = "$FIXTURE_SECRET_PLAINTEXT" ] \
    || fail "decrypted value did not match the seeded fixture (got: $DECRYPTED)"

  WRONG_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
  if node "$CRYPTO_CLI" decrypt "$ENCRYPTED_VALUE" "$WRONG_SECRET" >/dev/null 2>&1; then
    fail "encrypted config decrypted with the WRONG secret — envelope is not authenticating correctly"
  fi
  log "  encrypted config correctly fails to decrypt with the wrong secret"
fi

ELAPSED=$((SECONDS - STARTED_AT))
log "PASS — restore drill completed in ${ELAPSED}s"
