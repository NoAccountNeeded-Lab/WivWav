#!/bin/sh
# Safe Docker cleanup (see 'make reclaim'): dangling images and BuildKit cache
# above CACHE_KEEP_GB. Never touches volumes or containers.
# Usage: reclaim.sh [--all-cache]   (--all-cache also drops all unused build cache)
CACHE_KEEP_GB=${CACHE_KEEP_GB:-6}
docker image prune -f >/dev/null
if [ "${1:-}" = "--all-cache" ]; then
	docker builder prune -f >/dev/null
else
	docker builder prune -f --reserved-space "${CACHE_KEEP_GB}GB" >/dev/null
fi
