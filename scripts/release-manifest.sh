#!/usr/bin/env bash
# Render and verify the deployable production manifest.
#
#   release-manifest.sh render <out-file> <service>=<sha256:digest>...
#   release-manifest.sh verify <manifest-file>
#   release-manifest.sh selftest
#
# docker-compose.prod.yml in git is a TEMPLATE: its wivwav image digests are
# all-zero placeholders because protected main cannot take a CI push. The
# publish job renders a deployable copy (release manifest) from the template
# with the digests it pushed, verifies it, and persists it as a workflow
# artifact and GitHub Release asset. `verify` rejects any manifest that still
# contains a placeholder digest or a mutable-tag wivwav image.
set -euo pipefail

TEMPLATE="${TEMPLATE:-docker-compose.prod.yml}"
SERVICES="api web ops migrate"
ZERO="sha256:0000000000000000000000000000000000000000000000000000000000000000"

fail() { echo "release-manifest: $*" >&2; exit 1; }

verify() {
  local file="$1"
  [ -f "$file" ] || fail "manifest not found: $file"
  if grep -q "$ZERO" "$file"; then
    fail "$file contains placeholder (all-zero) digests; it is not deployable"
  fi
  local svc
  for svc in $SERVICES; do
    grep -qE "image: ghcr\.io/noaccountneeded-lab/wivwav/${svc}@sha256:[0-9a-f]{64}\$" "$file" \
      || fail "$file has no digest-pinned image for ${svc}"
  done
  if grep -E 'image: ghcr\.io/noaccountneeded-lab/wivwav/' "$file" | grep -vqE '@sha256:[0-9a-f]{64}$'; then
    fail "$file references a wivwav image without an immutable digest"
  fi
}

render() {
  local out="$1"; shift
  [ -f "$TEMPLATE" ] || fail "template not found: $TEMPLATE"
  cp "$TEMPLATE" "$out"
  local svc pair digest
  for svc in $SERVICES; do
    digest=""
    for pair in "$@"; do
      [ "${pair%%=*}" = "$svc" ] && digest="${pair#*=}"
    done
    [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "missing or malformed digest for ${svc}: '${digest}'"
    sed -i.bak -E "s#(wivwav/${svc}@)sha256:[0-9a-f]{64}#\1${digest}#" "$out"
    rm -f "$out.bak"
  done
  verify "$out"
}

selftest() {
  local dir; dir="$(mktemp -d)"; trap 'rm -rf "$dir"' RETURN
  local a="sha256:$(printf 'a%.0s' {1..64})" b="sha256:$(printf 'b%.0s' {1..64})"
  # The committed template must be rejected as a deployable manifest.
  if ( verify "$TEMPLATE" ) 2>/dev/null; then fail "selftest: template passed verify"; fi
  render "$dir/m.yml" "api=$a" "web=$b" "ops=$a" "migrate=$b"
  verify "$dir/m.yml"
  # Partial digests must not render.
  if ( render "$dir/bad.yml" "api=$a" ) 2>/dev/null; then fail "selftest: partial render succeeded"; fi
  if [ -n "${COMPOSE_VALIDATE:-}" ]; then
    local env="$dir/env"
    for v in CONFIG_ENCRYPTION_SECRET CORS_ORIGIN DATABASE_URL INTERNAL_API_SECRET MEILI_MASTER_KEY \
      NEXT_PUBLIC_API_URL OPS_ADMIN_PASSWORD OPS_ADMIN_USERNAME OPS_SESSION_SECRET POSTGRES_PASSWORD POSTGRES_USER; do
      echo "$v=placeholder" >> "$env"
    done
    docker compose -f "$dir/m.yml" --env-file "$env" config --quiet
    docker compose -f "$dir/m.yml" --env-file "$env" config | grep -q "wivwav/api@${a}" \
      || fail "selftest: compose config did not resolve rendered digest"
  fi
  echo "release-manifest selftest ok"
}

case "${1:-}" in
  render) shift; [ $# -ge 1 ] || fail "usage: render <out> svc=digest..."; render "$@" ;;
  verify) [ $# -eq 2 ] || fail "usage: verify <file>"; verify "$2"; echo "verified $2" ;;
  selftest) selftest ;;
  *) fail "usage: $0 render|verify|selftest" ;;
esac
