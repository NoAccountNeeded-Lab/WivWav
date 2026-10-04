#!/usr/bin/env bash
# Fails if a build output or image manifest contains compiled tests or
# test-only fixtures (#811).
#
# Usage:
#   scripts/check-no-test-artifacts.sh manifest <tar-listing-file>
#   scripts/check-no-test-artifacts.sh dirs <dist-dir>...
#
# Only paths under a `dist/` directory are inspected. Third-party content under
# node_modules (which may legitimately ship test files) is ignored, except for
# workspace packages that `pnpm deploy --legacy` places there: their `dist/`
# under node_modules/@wivwav/<pkg>/ or
# node_modules/.pnpm/<id>/node_modules/@wivwav/<pkg>/ is checked.
set -euo pipefail

mode="${1:-}"
shift || true

case "$mode" in
  manifest)
    listing=$(cat "${1:?manifest file required}")
    dir_count=1
    ;;
  dirs)
    [ "$#" -gt 0 ] || { echo "at least one dist dir required" >&2; exit 2; }
    listing=""
    dir_count=0
    for d in "$@"; do
      if [ -d "$d" ]; then
        dir_count=$((dir_count + 1))
        listing+=$(find "$d" -type f)$'\n'
      else
        echo "warning: not a directory, skipped: $d" >&2
      fi
    done
    ;;
  *)
    echo "usage: $0 manifest <file> | dirs <dir>..." >&2
    exit 2
    ;;
esac

pattern='(^|/)dist/(.*/)?((.*\.(test|spec)\.(js|mjs|cjs|d\.ts|js\.map|d\.ts\.map)$)|((__tests__|__mocks__|__snapshots__|test-support|test-helpers|fixtures)/))'
workspace_dist='(^|/)node_modules/(\.pnpm/[^/]+/node_modules/)?@wivwav/[^/]+/dist/'

file_count=$(printf '%s\n' "$listing" | grep -c . || true)
echo "scanned ${file_count} files in ${dir_count} directories"
if [ "$dir_count" -eq 0 ] || [ "$file_count" -eq 0 ]; then
  echo "error: nothing was scanned; refusing to pass an empty check" >&2
  exit 1
fi

candidates=$({ printf '%s\n' "$listing" | grep -v 'node_modules/' || true
               printf '%s\n' "$listing" | grep -E "$workspace_dist" || true; })
# Bounded: the first 50 offenders are enough to diagnose.
offenders=$(printf '%s\n' "$candidates" | grep -E "$pattern" | head -n 50 || true)

if [ -n "$offenders" ]; then
  echo "Test or fixture artifacts found in production output (first 50):"
  echo "$offenders"
  exit 1
fi
echo "No test or fixture artifacts found."
