# Oracle deployment (agent copy; human copy: oracle-deployment.md)

STATUS: PLANNED, nothing provisioned. Verified 2026-10-31. Update this file and the human copy in the same commit as any deploy change.

DECISIONS
- One Oracle Always Free A1 VM (arm64), full stack plus workers. No second Oracle VM: free pool is shared (2 OCPU, 12 GB total since 2026-06-15; AMD micro 1 GB x2; 200 GB disk; 10 TB egress).
- Overflow: move job-runner or meilisearch to Mac Mini first.
- Ingress: Cloudflare Tunnel (leaning, user has not said final yes). Fallback Caddy.
- Backups: pg-backup + R2 off-site.
- Idle reclaim: CPU p95, network, memory (A1) all <20% over 7 days.

SERVICES (docker-compose.prod.yml): postgres, pg-backup, valkey, meilisearch, migrate, api, edge, worker-ingress, job-runner, web, ops
PROFILES: worker-ingress, worker (job-runner), ops (off by default)
NOTE: only job-runner has mem_limit (2g).
ROUTING (verified in docker/edge/edge.conf): edge = API-only allowlist (/v1/, /webhooks/, /health, /telemetry/client-events; else 404), host port 3001. Website = web on 3000. Tunnel needs 2 routes: site -> web:3000, api host -> edge:8080. ops (3002) never public; Tailscale only. NEXT_PUBLIC_API_URL is runtime, not build-time.
DOMAINS: wivwav.com and wav.vin owned, both on Cloudflare. Proposed: wivwav.com -> web:3000; api.wivwav.com -> edge:8080; ops no public host (Tailscale); wav.vin -> redirect (role undecided). Not created yet.
REPO IS PUBLIC: never write secrets, IPs, Tailscale names, tunnel IDs or account ids into any committed file. Arm64 option: GitHub-hosted arm runner (free for public repos, confirm).

GAPS / BLOCKERS
1. User's Oracle account not recognized (maybe deleted). User must recover or sign up and enter card; agents cannot.
2. CI builds amd64 only (no platforms key in ci.yml). A1 is arm64. Need multi-arch build: QEMU, arm runner, or self-hosted runner. Undecided.
3. Release compose bind-mounts ./docker/... so a repo checkout must sit beside it.
4. WORKER_TOKEN must equal WORKER_API_SECRET. docs/ops/client-worker.md and docs/ops/worker-fleet-architecture.md:210 wrongly say INTERNAL_API_SECRET.
5. Compose interpolates all services: set ops vars and WORKER_TOKEN even when those services are off; name services explicitly on the command line.

PHASES: 0 account (user) > 1 VM in console > 2 harden + Tailscale + swap > 3 arm64 images > 4 secrets, checkout, compose up > 5 tunnel + DNS + CORS_ORIGIN, NEXT_PUBLIC_API_URL, OPS_PUBLIC_ORIGIN > 6 edge-smoke.sh + restore drill > 7 one week of measurements.

SECRETS: user is dropping 1Password; do not use `op`. Apple Passwords has no official CLI/MCP. Undecided between sops+age and Vaultwarden (macmini) + bw. Human logins stay in the user's own password manager; agents never type passwords.
TOOLS: have ansible-playbook, docker, gh, ssh, tailscale. Missing sops, age, bw. Missing oci, terraform/tofu, cloudflared. No Oracle MCP exists; Cloudflare MCP has no Tunnel/DNS tools. Create VM by hand once; record settings in human copy section 9.

ROLLBACK: rerun previous deploy-<sha> manifest per deployment.md.

ENFORCEMENT: scripts/check-docs.sh (staged guard), scripts/check-deploy-docs.sh (in pnpm lint, every compose service must appear in oracle-deployment.md).
