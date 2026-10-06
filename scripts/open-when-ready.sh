#!/bin/sh
# Open a URL in the default browser once it responds, so a target can return
# control immediately and the page appears when the service is ready.
# Usage: open-when-ready.sh [--if-down] <url> [timeout-seconds]
# --if-down: do nothing when the URL already responds at launch, so a stale
#            server left on that port is not mistaken for the one just started.
# Silent no-op when NO_OPEN is set, in CI, inside a container, or without an opener.
if_down=
[ "${1:-}" = "--if-down" ] && { if_down=1; shift; }
url=${1:?usage: open-when-ready.sh [--if-down] <url> [timeout-seconds]}
timeout=${2:-180}

if [ -n "${NO_OPEN:-}" ] || [ -n "${CI:-}" ] || [ -f /.dockerenv ]; then exit 0; fi
opener=$(command -v open || command -v xdg-open) || exit 0
if [ -n "$if_down" ] && curl -fsS -o /dev/null -m 2 "$url" 2>/dev/null; then exit 0; fi

i=0
while [ "$i" -lt "$timeout" ]; do
	if curl -fsS -o /dev/null -m 2 "$url" 2>/dev/null; then
		"$opener" "$url" >/dev/null 2>&1
		exit 0
	fi
	i=$((i + 2))
	sleep 2
done
exit 0
