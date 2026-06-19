# Grafana Alerting Runbook

Last verified: 2026-06-18

WivWav beta alerting is provisioned from `docker/grafana/provisioning/alerting`.
Grafana loads these files when the `obs` profile starts:

- `contact-points.yaml` provisions separate warning and critical email contact points.
- `notification-policies.yaml` routes `severity=warning` and `severity=critical` differently.
- `wivwav-alert-rules.yaml` defines Grafana-managed alert rules backed by Prometheus metrics.

## Where Alerts Go

Warnings route to `wivwav-beta-warning-email`.
Critical alerts route to `wivwav-beta-critical-email`.

Set these variables before starting Grafana if notifications should leave the local stack:

| Variable | Purpose |
| --- | --- |
| `GF_SMTP_ENABLED=true` | Enables Grafana OSS email delivery. |
| `GF_SMTP_HOST` | SMTP host and port for Grafana email. |
| `GF_SMTP_USER` / `GF_SMTP_PASSWORD` | SMTP credentials, if required. |
| `GF_SMTP_FROM_ADDRESS` | Sender address for alert emails. |
| `WIVWAV_ALERT_EMAIL_TO` | Semicolon-separated destination email list. Defaults to `ops@example.invalid` so provisioning is valid until a real destination is configured. |

Grafana OSS requires SMTP configuration for email notifications. Grafana Cloud does not require SMTP setup for email. See Grafana email docs: https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/configure-email/

## Contact Point Test

Before beta operations rely on these alerts, send and record one test notification:

1. Start the observability profile with the destination variables set.
2. Open Grafana at `http://localhost:3003`.
3. Go to **Alerting -> Contact points**.
4. Open `wivwav-beta-warning-email`.
5. Click **Test** and verify the email arrives.
6. Repeat for `wivwav-beta-critical-email`.
7. Record the test in the PR notes:
   - Contact point:
   - Destination:
   - Timestamp:
   - Result:

Grafana's Slack contact point also supports a Slack API token or incoming webhook and has an in-UI **Test** action. Use Slack only if there is an active operator channel. See Grafana Slack docs: https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/integrations/configure-slack/

To add Pushover phone push for critical alerts, add a Pushover integration to `wivwav-beta-critical-email` in Grafana or provision a second receiver with `apiToken`, `userKey`, and `priority: '1'`. Grafana lists Pushover as a supported contact point integration. See Grafana contact point docs: https://grafana.com/docs/grafana/latest/alerting/configure-notifications/manage-contact-points/

## Alert Rules

### API Target Down

PromQL: `min(up{job="wivwav_api"}) < 1` for 5 minutes.

Meaning: Prometheus cannot scrape the API `/metrics` endpoint, which usually means the API is down, unhealthy, or unreachable from the Docker network.

First response:

1. Check `docker compose ps api prometheus`.
2. Open `http://localhost:3001/health`.
3. Check API logs in Grafana or `/ops/logs`.
4. Restart the API only after confirming the failure is not a broader Docker network or dependency issue.

### API 5xx Rate High

PromQL: `sum(rate(wivwav_http_requests_total{status_class="5xx"}[5m])) > 0.05` for 5 minutes.

Meaning: The API is returning sustained server errors.

First response:

1. Open the WivWav Logs dashboard and filter `service=api`, `level=error`.
2. Check recent deploys or schema/config changes.
3. Use the route label in `wivwav_http_requests_total` to identify the failing endpoint.
4. If user traffic is affected, treat as critical until the error rate returns to zero.

### Postgres Unavailable

PromQL: `wivwav_db_up < 1` for 3 minutes.

Meaning: The API cannot complete a simple PostgreSQL probe.

First response:

1. Check `docker compose ps postgres api`.
2. Inspect Postgres container health and logs.
3. Check for migrations or schema drift if the API recently changed.
4. Avoid restarting Postgres while migrations are running.

### Valkey Unavailable

PromQL: `wivwav_valkey_up < 1` for 3 minutes.

Meaning: The API cannot ping Valkey, which affects cache and BullMQ-backed queues.

First response:

1. Check `docker compose ps valkey api scraper`.
2. Open `/ops/queues` and confirm whether queue stats load.
3. Check scraper logs for BullMQ connection errors.

### Meilisearch Unavailable

PromQL: `wivwav_meilisearch_up < 1` for 3 minutes.

Meaning: The API cannot reach Meilisearch health, so listing search may fail or return stale results.

First response:

1. Check `docker compose ps meilisearch api`.
2. Open the search UI and API `/v1/listings`.
3. If Meilisearch recovered after downtime, run **Sync Meilisearch** from `/ops/queues`.

### Loki Unavailable

PromQL: `wivwav_loki_up < 1` for 5 minutes.

Meaning: Loki readiness failed, so Grafana and `/ops/logs` may not query logs.

First response:

1. Check `docker compose ps loki alloy grafana`.
2. Check Alloy logs for push errors.
3. Confirm Grafana Explore can query `{project="wivwav"}` after recovery.

### Queue Failed Jobs Present

PromQL: `sum by (queue) (wivwav_queue_depth{status="failed"}) > 0` for 5 minutes.

Meaning: At least one BullMQ queue has failed jobs.

First response:

1. Open `/ops/queues`.
2. Expand the queue named in the alert.
3. Use Bull Board for payload and stack trace details.
4. Retry only after checking whether the failure is deterministic.

### Queue Backlog High

PromQL: `sum by (queue) (wivwav_queue_depth{status=~"waiting|active"}) > 100` for 30 minutes.

Meaning: A queue is not draining fast enough for beta expectations.

First response:

1. Open `/ops/queues` and identify the queue.
2. Check whether the queue is paused.
3. Check worker logs for rate limits or dependency failures.
4. For crawler queues, confirm the backlog is not expected after a large source scrape.

### Source Scrape Freshness Stale

PromQL: `time() - wivwav_scraper_last_successful_run_timestamp_seconds > 86400` for 15 minutes.

Meaning: No successful source scrape has completed in 24 hours.

First response:

1. Open `/ops/runs` and review recent source scrape runs.
2. Open `/ops/sources` and check for `needs_remapping` or source errors.
3. Trigger one source manually only after checking robots/rate-limit concerns.

### NHTSA Refresh Stale

PromQL:

- `time() - wivwav_nhtsa_queue_last_completed_timestamp_seconds{queue="nhtsa-recalls"} > 129600`
- `max by (queue) (time() - wivwav_nhtsa_queue_last_completed_timestamp_seconds{queue=~"nhtsa-complaints|nhtsa-safety-ratings"}) > 691200`

Meaning: NHTSA recalls, complaints, or safety ratings refresh jobs have not completed inside the expected cadence plus buffer.

First response:

1. Open `/ops/schedules` and confirm the NHTSA schedules are enabled.
2. Open `/ops/queues` and inspect failed jobs for the named queue.
3. Check scraper logs for NHTSA API errors or rate limiting.
4. Trigger the stale queue manually only after confirming the previous run is not still active.

## Listing Report Alerts

Issue #147 has not exposed listing-report tables or Prometheus metrics in this tree, so listing-report alert rules are intentionally not provisioned yet.

When #147 exists, add aggregate metrics and alerts only:

- `listing_reports_unresolved_total`: alert when unresolved backlog exceeds the agreed beta threshold.
- `listing_reports_created_total`: alert on rolling 1 hour or 24 hour spikes.
- Per-source stale or sold report volume: alert on aggregate source-level spikes that suggest scraper freshness drift.

Do not send one notification per report. Listing-report alerts should batch by `alertname`, `severity`, and `source` so the operator receives one operational signal for abnormal volume or backlog.

## Escalation Options And Costs

Costs were rechecked on 2026-06-18. Recheck again before buying or enabling paid escalation because messaging prices and carrier requirements change.

| Option | Current note | Recommended use |
| --- | --- | --- |
| Email | No extra Grafana fee. Grafana OSS requires SMTP; Grafana Cloud does not. | Default for all warnings and criticals. |
| Pushover | Individual use is a $4.99 USD one-time purchase per platform; Teams is $5 USD per user per month; users can send up to 10,000 messages per month for free. Source: https://pushover.net/pricing | Best low-friction beta phone push path for critical alerts. |
| AWS SNS SMS | SMS is pay-as-you-go and country/carrier dependent. US 10DLC requires company registration ($4 one-time), campaign monthly fees ($10 regular or $2 low-volume), and $1/month per 10DLC number; US toll-free numbers are $2/month; US short codes list $650 setup and $995/month. Source: https://aws.amazon.com/sns/sms-pricing/ | Use only if real SMS is required and AWS is already part of operations. |
| Twilio SMS webhook | US SMS long-code/toll-free/short-code listed at $0.0083 outbound and $0.0083 inbound per segment before carrier fees; number leases start at $1.15/month for long codes and $2.15/month for toll-free; carrier fees and A2P 10DLC onboarding apply. Source: https://www.twilio.com/en-us/sms/pricing/us | Defer unless a custom webhook bridge is acceptable. |
| PagerDuty / Opsgenie | Grafana supports both as contact point integrations, but plan pricing should be verified at vendor selection time. | Use only when WivWav has a real on-call rotation. |

Beta recommendation: email for every warning and critical alert. Add Pushover to the critical contact point when the operator group has app tokens ready. Defer SMS until email and push are proven insufficient.
