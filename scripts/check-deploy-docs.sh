#!/bin/bash
# Fails if a service in docker-compose.prod.yml is missing from the Oracle deployment docs.
# Runs in `pnpm lint`. shortcut: checks service names only, not ports or env; extend if drift shows up.
set -u
cd "$(dirname "$0")/.."

COMPOSE=docker-compose.prod.yml
DOCS=(docs/ops/oracle-deployment.md docs/ops/oracle-deployment.agent.md)

# Top-level keys (two-space indent) under `services:`.
SERVICES=$(awk '/^services:/{s=1;next} /^[^ #]/{s=0} s && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/{gsub(/[ :]/,"");print}' "$COMPOSE")
[ -n "$SERVICES" ] || { echo "check-deploy-docs: found no services in $COMPOSE"; exit 1; }

FAILED=0
for doc in "${DOCS[@]}"; do
  [ -f "$doc" ] || { echo "check-deploy-docs: missing $doc"; FAILED=1; continue; }
  for svc in $SERVICES; do
    grep -qE "(^|[^a-zA-Z0-9_-])$svc([^a-zA-Z0-9_-]|$)" "$doc" || { echo "check-deploy-docs: '$svc' is in $COMPOSE but not in $doc"; FAILED=1; }
  done
done
exit $FAILED
