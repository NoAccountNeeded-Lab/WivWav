# Observability Stack Upgrade

This runbook covers the local Docker Compose observability stack. The current
tested versions are:

| Component | Previous | Current | Migration notes |
| --- | --- | --- | --- |
| Grafana | 11.3.0 | 13.1.0 | Major upgrade. Review the [Grafana 12](https://grafana.com/docs/grafana/latest/upgrade-guide/upgrade-v12.0/) and [Grafana 13](https://grafana.com/docs/grafana/latest/upgrade-guide/upgrade-v13.0/) guides. Grafana 13 performs a one-time unified-storage migration for folders and dashboards. The WivWav stack does not enable Git Sync or install the removed image-renderer plugin. |
| Loki | 3.3.2 | 3.7.3 | Same major. Review the [Loki upgrade guide](https://grafana.com/docs/loki/latest/setup/upgrade/) and [3.7 release notes](https://grafana.com/docs/loki/latest/release-notes/v3-7/). WivWav already uses the required TSDB index and v13 schema. The 3.7 image is distroless, so its Compose health check uses the Loki binary and runtime smoke tests call `/ready` from the host. |
| Grafana Alloy | 1.4.3 | 1.17.1 | Same major. Review the [Alloy release notes](https://grafana.com/docs/alloy/latest/release-notes/) and [CLI reference](https://grafana.com/docs/alloy/latest/reference/cli/). The upstream image has Bash but no `wget` or `curl`; the readiness probe uses Bash `/dev/tcp` against `/-/ready`. |
| Prometheus | 2.54.1 | 3.13.0 | Major upgrade. Review the [Prometheus 3 migration guide](https://prometheus.io/docs/prometheus/latest/migration/). A Prometheus 3 TSDB can only be read by Prometheus 2.55 or newer, so rollback to 2.54.1 requires restoring the volume backup. WivWav does not use removed feature flags or remote read. |

## Before upgrading

Stop writers and back up all four named volumes before starting a target image.
The stopped Compose containers are retained so `--volumes-from` selects the
correct project-scoped volumes even when `COMPOSE_PROJECT_NAME` is customized.

```bash
backup_dir="$PWD/.backups/observability-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
docker compose --profile obs stop alloy grafana prometheus loki

docker run --rm --volumes-from "$(docker compose ps -aq grafana)" \
  -v "$backup_dir:/backup" busybox:1.37.0 \
  tar -czf /backup/grafana_data.tgz -C /var/lib/grafana .
docker run --rm --volumes-from "$(docker compose ps -aq loki)" \
  -v "$backup_dir:/backup" busybox:1.37.0 \
  tar -czf /backup/loki_data.tgz -C /loki .
docker run --rm --volumes-from "$(docker compose ps -aq alloy)" \
  -v "$backup_dir:/backup" busybox:1.37.0 \
  tar -czf /backup/alloy_data.tgz -C /var/lib/alloy .
docker run --rm --volumes-from "$(docker compose ps -aq prometheus)" \
  -v "$backup_dir:/backup" busybox:1.37.0 \
  tar -czf /backup/prometheus_data.tgz -C /prometheus .

for archive in "$backup_dir"/*.tgz; do tar -tzf "$archive" >/dev/null; done
```

Record `backup_dir` in the upgrade notes. Do not continue if any archive is
missing, empty, or fails the final archive check.

Validate the existing configuration with the exact target images before
allowing them to open persisted data:

```bash
docker run --rm -v "$PWD/docker/loki:/etc/loki:ro" \
  grafana/loki:3.7.3 \
  -config.file=/etc/loki/loki-config.yaml -verify-config=true

docker run --rm -v "$PWD/docker/alloy:/etc/alloy:ro" \
  grafana/alloy:v1.17.1 validate /etc/alloy/config.alloy

docker run --rm --entrypoint /bin/promtool \
  -v "$PWD/docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro" \
  prom/prometheus:v3.13.0 check config /etc/prometheus/prometheus.yml

docker compose --profile obs config --quiet
```

## Upgrade and smoke checks

Pull and start the profile after the backup and validation commands pass:

```bash
docker compose pull loki alloy prometheus grafana
docker compose --profile obs up -d
docker compose --profile obs ps
```

Wait for `loki`, `alloy`, `prometheus`, and `grafana` to report `healthy`.
Then verify Loki's runtime endpoint and prove the Alloy readiness command fails
when no Alloy server is present:

```bash
curl --fail --silent --show-error http://localhost:3100/ready

if docker run --rm --entrypoint /usr/bin/bash grafana/alloy:v1.17.1 \
  -c "exec 3<>/dev/tcp/127.0.0.1/12345 && printf 'GET /-/ready HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3 && grep -q '^HTTP/1.1 200' <&3"
then
  echo "unexpected Alloy readiness success without a server" >&2
  exit 1
fi
```

Ship a unique API log through Alloy, restart Loki, and query the marker:

```bash
marker="obs-upgrade-$(date +%s)"
curl --silent "http://localhost:3001/$marker" >/dev/null
sleep 20
query="{service=\"api\"} |= \"$marker\""
docker compose restart loki
until curl --fail --silent http://localhost:3100/ready >/dev/null; do sleep 2; done
curl --fail --silent --get \
  --data-urlencode "query=$query" \
  --data-urlencode 'since=10m' \
  http://localhost:3100/loki/api/v1/query_range |
  jq -e '.data.result | length > 0'
```

Confirm Prometheus retained metrics across restart and the API target is up:

```bash
end=$(date +%s)
start=$((end - 600))
curl --fail --silent --get \
  --data-urlencode 'query=up{job="wivwav_api"}' \
  --data-urlencode "start=$start" \
  --data-urlencode "end=$end" \
  --data-urlencode 'step=15s' \
  http://localhost:9090/api/v1/query_range |
  jq -e '.data.result | length > 0'
docker compose restart prometheus
until curl --fail --silent http://localhost:9090/-/ready >/dev/null; do sleep 2; done
curl --fail --silent --get \
  --data-urlencode 'query=up{job="wivwav_api"}' \
  --data-urlencode "start=$start" \
  --data-urlencode "end=$end" \
  --data-urlencode 'step=15s' \
  http://localhost:9090/api/v1/query_range |
  jq -e '.data.result | length > 0'
curl --fail --silent --get \
  --data-urlencode 'query=up{job="wivwav_api"}' \
  http://localhost:9090/api/v1/query |
  jq -e '.data.result[0].value[1] == "1"'
```

Confirm both Grafana datasources, both provisioned dashboards, and provisioned
alert rules survived the Grafana migration:

```bash
for datasource in loki prometheus; do
  curl --fail --silent \
    "http://localhost:3003/api/datasources/uid/$datasource/health" |
    jq -e '.status == "OK"'
done
for dashboard in wivwav-logs wivwav-system; do
  curl --fail --silent "http://localhost:3003/api/dashboards/uid/$dashboard" |
    jq -e '.dashboard.uid == "'"$dashboard"'"'
done
curl --fail --silent http://localhost:3003/api/v1/provisioning/alert-rules |
  jq -e 'length > 0'

docker compose --profile obs ps
```

Do not accept the upgrade if a datasource is not `OK`, either dashboard is
missing, no alert rules are returned, either persistence query is empty, or any
observability service is not healthy.

## Rollback

Stop the profile before rollback. Grafana 13 and Prometheus 3 perform persisted
data migrations, so changing image tags alone is not a safe rollback. Restore
all four archives as one consistent snapshot, then restore the previous Compose
file and recreate the profile.

```bash
docker compose --profile obs stop alloy grafana prometheus loki

docker run --rm --volumes-from "$(docker compose ps -aq grafana)" \
  -v "$backup_dir:/backup:ro" busybox:1.37.0 sh -c \
  'find /var/lib/grafana -mindepth 1 -delete && tar -xzf /backup/grafana_data.tgz -C /var/lib/grafana'
docker run --rm --volumes-from "$(docker compose ps -aq loki)" \
  -v "$backup_dir:/backup:ro" busybox:1.37.0 sh -c \
  'find /loki -mindepth 1 -delete && tar -xzf /backup/loki_data.tgz -C /loki'
docker run --rm --volumes-from "$(docker compose ps -aq alloy)" \
  -v "$backup_dir:/backup:ro" busybox:1.37.0 sh -c \
  'find /var/lib/alloy -mindepth 1 -delete && tar -xzf /backup/alloy_data.tgz -C /var/lib/alloy'
docker run --rm --volumes-from "$(docker compose ps -aq prometheus)" \
  -v "$backup_dir:/backup:ro" busybox:1.37.0 sh -c \
  'find /prometheus -mindepth 1 -delete && tar -xzf /backup/prometheus_data.tgz -C /prometheus'

git checkout <pre-upgrade-revision> -- docker-compose.yml
docker compose --profile obs up -d --force-recreate
```

Repeat all smoke checks against the restored versions. Keep the backup until
the upgraded stack has passed at least one full local development session.

## Known incompatibilities

- Prometheus 3 data cannot be read by Prometheus 2.54.1. Restore the backup for
  that rollback; do not point the old image at an upgraded volume.
- Grafana 13's unified-storage migration is one-way for this runbook. Restore
  `grafana_data` before returning to Grafana 11.
- Loki 3.7's distroless image cannot execute shell-based health checks.
- Alloy's upstream image does not contain `wget` or `curl`; use the bundled
  Bash readiness probe from Compose.
