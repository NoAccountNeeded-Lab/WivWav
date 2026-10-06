#!/bin/sh
# Safe Docker cleanup (see 'make reclaim'): dangling images and BuildKit cache
# above CACHE_KEEP_GB. Never touches volumes or containers.
# Usage: reclaim.sh [--all-cache]   (--all-cache also drops all unused build cache)
#
# Only one reclaim runs at a time (the background one that 'make build' starts
# must not overlap the next one); a second caller exits quietly.
CACHE_KEEP_GB=${CACHE_KEEP_GB:-6}
LOCK=${TMPDIR:-/tmp}/wivwav-reclaim.lock

if ! mkdir "$LOCK" 2>/dev/null; then
	pid=$(cat "$LOCK/pid" 2>/dev/null)
	if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then exit 0; fi
	rm -rf "$LOCK"
	mkdir "$LOCK" 2>/dev/null || exit 0
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM

docker image prune -f >/dev/null || { echo "reclaim: 'docker image prune' failed (is Docker running?)" >&2; exit 1; }
if [ "${1:-}" = "--all-cache" ]; then
	docker builder prune -f >/dev/null
else
	docker builder prune -f --reserved-space "${CACHE_KEEP_GB}GB" >/dev/null
fi || { echo "reclaim: 'docker builder prune' failed (does this Docker support --reserved-space?)" >&2; exit 1; }
