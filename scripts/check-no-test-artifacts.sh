#!/usr/bin/env bash
# Fails if a build output or image manifest contains compiled tests or
# test-only fixtures (#811).
#
# Usage:
#   scripts/check-no-test-artifacts.sh manifest <tar-listing-file>
#   scripts/check-no-test-artifacts.sh dirs <dist-dir>...
#
# Only paths under a `dist/` directory outside node_modules are inspected, so
# third-party packages (which may legitimately ship test files) are ignored.
set -euo pipefail

mode="${1:-}"
shift || true

case "$mode" in
  manifest)
    listing=$(cat "${1:?manifest file required}")
    ;;
  dirs)
    [ "$#" -gt 0 ] || { echo "at least one dist dir required" >&2; exit 2; }
    listing=$(for d in "$@"; do [ -d "$d" ] && find "$d" -type f; done)
    ;;
  *)
    echo "usage: $0 manifest <file> | dirs <dir>..." >&2
    exit 2
    ;;
esac

pattern='(^|/)dist/.*(\.(test|spec)\.(js|mjs|cjs|d\.ts|js\.map|d\.ts\.map)$|/(__tests__|__mocks__|__snapshots__|test-support|test-helpers|fixtures)/)'
# Bounded: the first 50 offenders are enough to diagnose.
offenders=$(printf '%s\n' "$listing" | grep -v 'node_modules/' | grep -E "$pattern" | head -n 50 || true)

if [ -n "$offenders" ]; then
  echo "Test or fixture artifacts found in production output (first 50):"
  echo "$offenders"
  exit 1
fi
echo "No test or fixture artifacts found."
