#!/bin/sh
# Open a URL in the default browser once it responds, so a target can return
# control immediately and the page appears when the service is ready.
# Usage: open-when-ready.sh <url> [timeout-seconds]
# Silent no-op when NO_OPEN is set, in CI, inside a container, or without an opener.
url=${1:?usage: open-when-ready.sh <url> [timeout-seconds]}
timeout=${2:-180}

[ -n "${NO_OPEN:-}" ] || [ -n "${CI:-}" ] || [ -f /.dockerenv ] && exit 0
opener=$(command -v open || command -v xdg-open) || exit 0

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
