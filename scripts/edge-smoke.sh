#!/usr/bin/env bash
# Black-box proof of the public edge and worker-ingress allowlists (#1225).
# Starts the real nginx configs in front of a stub upstream named "api" that
# answers 200 for everything, so any 200 means the edge forwarded the path.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="${EDGE_IMAGE:-nginxinc/nginx-unprivileged:1.27-alpine}"
NET="edge-smoke-$$"
cleanup() { docker rm -f "es-api-$$" "es-edge-$$" "es-ingress-$$" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker network create "$NET" >/dev/null

STUB="$(mktemp)"; trap 'rm -f "$STUB"; cleanup' EXIT
printf 'server { listen 3001; location / { return 200 "upstream-reached"; } }\n' > "$STUB"
chmod 644 "$STUB" # mktemp is 0600; the nginx user in the container must read it
docker run -d --name "es-api-$$" --network "$NET" --network-alias api -v "$STUB:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" >/dev/null
docker run -d --name "es-edge-$$" --network "$NET" -p 127.0.0.1::8080 \
  -v "$PWD/docker/edge/edge.conf:/etc/nginx/conf.d/default.conf:ro" \
  -v "$PWD/docker/edge/proxy.inc:/etc/nginx/conf.d/proxy.inc:ro" "$IMAGE" >/dev/null
docker run -d --name "es-ingress-$$" --network "$NET" -p 127.0.0.1::8080 \
  -v "$PWD/docker/edge/coordinator.conf:/etc/nginx/conf.d/default.conf:ro" "$IMAGE" >/dev/null

port() { docker port "$1" 8080/tcp | head -1 | sed 's/.*://'; }
EDGE="http://127.0.0.1:$(port "es-edge-$$")"
INGRESS="http://127.0.0.1:$(port "es-ingress-$$")"
fails=0
# Poll until a listener answers (any HTTP status) instead of sleeping a fixed time.
wait_up() {
  for _ in $(seq 1 50); do
    curl -s -o /dev/null --max-time 1 "$1/health" && return 0
    sleep 0.2
  done
  echo "FAIL $1 never answered"; exit 1
}
wait_up "$EDGE"; wait_up "$INGRESS"
# expect <base> <method> <path> <status>; a valid-looking bearer is sent so a
# 404 proves the edge denies the route rather than the API rejecting a token.
expect() {
  local got; got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X "$2" -H 'Authorization: Bearer valid-looking-token' --path-as-is "$1$3" || true)"
  if [ "$got" = "$4" ]; then echo "ok   $2 $3 -> $got"; else echo "FAIL $2 $3 -> $got (want $4)"; fails=$((fails+1)); fi
}

for p in /health /telemetry/client-events /v1/listings /v1/listings/abc /webhooks/stripe; do expect "$EDGE" GET "$p" 200; done
for p in /admin/runs /internal/ops/runs /internal/config/ai.intake.model /internal/scraper/x /internal/workers/ws /ops/queues/board \
  /ops/api/x /diagnostics/diagnostic-context /docs /openapi.json /metrics /v1/../internal/ops/runs /v1/%2e%2e/internal/ops/runs \
  /healthz /telemetry/client-events/x / //internal/ops/runs /v1/..//internal/ops/runs /v1%2f..%2finternal/ops/runs /health/../internal/ops/runs \
  /%69nternal/ops/runs /INTERNAL/ops/runs /V1/listings /ops/queues/board/../../internal/ops/runs; do expect "$EDGE" GET "$p" 404; done

for p in /internal/scraper/detail-extract/submit /internal/workers/ws; do expect "$INGRESS" GET "$p" 200; done
for p in /v1/listings /health /internal/ops/runs /internal/config/x /admin/runs /docs /; do expect "$INGRESS" GET "$p" 404; done

if [ "$fails" -ne 0 ]; then
  for c in "es-edge-$$" "es-ingress-$$" "es-api-$$"; do echo "--- logs: $c"; docker logs --tail 20 "$c" 2>&1 || true; done
  echo "edge-smoke: $fails failure(s)"; exit 1
fi
echo "edge-smoke ok"
