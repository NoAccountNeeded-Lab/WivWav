#!/bin/sh
# Free-space gate for the Docker build targets (see 'make disk-check').
#
# Checks the host disk and the Docker VM. When either is short it reclaims
# space (stage 1: dangling images + BuildKit cache above CACHE_KEEP_GB; stage 2:
# all unused build cache) and re-checks, failing only if space is still short.
#
# Env: MIN_FREE_GB (Docker VM), MIN_HOST_FREE_GB (host), CACHE_KEEP_GB.
set -u

MIN_FREE_GB=${MIN_FREE_GB:-10}
MIN_HOST_FREE_GB=${MIN_HOST_FREE_GB:-15}
CACHE_KEEP_GB=${CACHE_KEEP_GB:-6}
export CACHE_KEEP_GB

gb() { awk 'NR==2 {print int($4/1048576)}'; }

# Prints a reason and returns 1 when space is short.
check() {
	host=$(df -Pk . | gb)
	case "$host" in ''|*[!0-9]*) echo "Could not determine host free space." >&2; return 2 ;; esac
	if [ "$host" -lt "$MIN_HOST_FREE_GB" ]; then
		echo "Host disk has ${host}GB free (need ${MIN_HOST_FREE_GB}GB); the Docker VM's disk grows into it." >&2
		return 1
	fi
	vm=$(docker run --rm alpine df -Pk / | gb) || return 2
	case "$vm" in ''|*[!0-9]*) echo "Could not determine Docker VM free space." >&2; return 2 ;; esac
	if [ "$vm" -lt "$MIN_FREE_GB" ]; then
		echo "Docker VM has ${vm}GB free (need ${MIN_FREE_GB}GB)." >&2
		return 1
	fi
}

check; rc=$?
[ "$rc" -eq 0 ] && exit 0
[ "$rc" -eq 2 ] && exit 1

echo "Low disk space: reclaiming dangling images and build cache above ${CACHE_KEEP_GB}GB, then retrying..." >&2
"$(dirname "$0")/reclaim.sh"
check && exit 0

echo "Still short: clearing all unused build cache (next build will be slower), then retrying..." >&2
"$(dirname "$0")/reclaim.sh" --all-cache
check && exit 0

echo "Not enough free space after cleanup. Free disk space, or lower the bar with MIN_FREE_GB=<n> / MIN_HOST_FREE_GB=<n>." >&2
exit 1
