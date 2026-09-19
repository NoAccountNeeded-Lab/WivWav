# Client Worker Startup

The WivWav worker is the process that actually runs crawler jobs. Once it is
started, it connects to the API coordinator, sends a hello message over
`/internal/workers/ws`, waits for jobs, runs them, and reports results back over
the authenticated `/internal/workers/*` and `/internal/scraper/*` HTTP routes.

Operators should not need to know source IDs, queue names, or the worker
protocol to start crawling. Start the worker, then use Ops to trigger or watch
jobs.

## Local all-in-one startup

Use this when the client machine should run the local API, local database, and
local worker together.

```bash
make worker
```

That command starts the Docker `job-runner` service with the `worker` profile
and starts Ops so an operator can trigger jobs from the browser. Docker Compose
also starts the API dependencies the worker needs:

- Postgres
- Valkey
- Meilisearch
- API
- database migrations
- Ops

The worker uses the API's local development secret by default, connects to
`http://api:3001`, advertises Chromium capability, and waits for jobs.

To watch it connect and pick up jobs:

```bash
make worker-logs
```

Useful log events:

- `worker.starting` means the worker process loaded config.
- `ws.open` means it connected to the coordinator.
- `job.dispatch` means it accepted a job.

## Remote coordinator startup

Use this when the client machine should only run a worker while the API,
database, queues, and Ops app run somewhere else.

```bash
WORKER_COORDINATOR_URL=https://api.example.com \
WORKER_TOKEN=<worker bearer token> \
make worker-remote
```

`make worker-remote` starts the same Docker `job-runner` service but skips local
API dependencies. The worker dials the coordinator URL over WebSocket and sends
all job results back over authenticated HTTP. It does not receive a database
URL, Valkey URL, or Meilisearch key.

For production-like hosts, leave Docker's restart policy enabled. The service is
configured with `restart: unless-stopped`, so it comes back after a reboot once
Docker starts.

## Running MobilityVanSales

After the worker is connected:

1. Open Ops.
   - `make worker`: `http://localhost:3002/ops/sources`
   - Full local Docker stack: `http://localhost:3002/ops/sources`
   - Local hot-reload stack: `http://localhost:4002/ops/sources`
2. Find `MobilityVanSales`.
3. Click **Run Now**.
4. Watch the source row, `/ops/runs`, or `make worker-logs`.

`Run Now` enqueues a `source-scrape` job for that source. The connected worker
automatically receives it, runs the `mobility-van-sales` adapter, and submits
listing updates back to the API. MobilityVanSales is a scrape-only source, so it
does not require separate detail-crawl or detail-extract jobs.

## Troubleshooting

If a job is queued but never starts:

- Confirm `make worker-logs` shows `ws.open`.
- Confirm the API has `WORKER_GATEWAY_ENABLED=true`.
- Confirm the worker token matches the coordinator's `INTERNAL_API_SECRET`.
- Confirm `/ops/queues` shows the `source-scrape` queue unpaused.

If the worker repeatedly reconnects:

- Check that `WORKER_COORDINATOR_URL` reaches the API from the client machine.
- Check that the coordinator accepts the bearer token.
- Check API logs for `/internal/workers/ws` authentication failures.

If MobilityVanSales runs but produces no listings:

- Check the source status in `/ops/sources`.
- Open the source detail page and inspect the pipeline state.
- Search worker/API logs for `mobility-van-sales`.
