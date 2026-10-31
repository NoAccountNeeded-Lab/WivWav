# Plan: deploy WivWav data collector to the Mac Mini

Goal: always-on DB + API on the Mac Mini so listing data (price/mileage history = the moat)
starts accumulating. Website NOT needed. Status as of 2026-10-13.

## Decided
- Host: Mac Mini (free). Paid VPS and multi-account free-tier tricks rejected; Oracle free = optional later worker host.
- Stay on Postgres (16 files of PG-specific SQL; managed/any PG host stays possible via dump/restore).
- NO raw-page archive to object storage (conflicts with private-seller-data-policy.md raw-page deletion contract).
- Off-site backup of OUR pg dumps is required in the same rollout (sda is a ~15-yr-old laptop HDD).
- Orchestrate with other agents; tests on BOTH sides (WivWav repo + macmini-server repo).

## Verified facts
- Mac Mini 192.168.2.100: Ubuntu 24.04, x86_64, 2 cores, 7.5 GB RAM (~3 GB free, swap in use), 41 GB free on HDD, 23 containers, Docker 29.
  Ports 3001/5432/6379/7700 free. SSH alias `macmini`; repo rules say user ai_agent, password sudo.
- Server repo: ~/Projects/Server/macmini-server (Ansible; roles/<x> + stacks/<x>/docker-compose.yml.j2; follow roles/bigcapital).
  Has another session's UNCOMMITTED edits + a *.secret.yml: stage only our new files. Ask before committing role changes.
  Run scoped: `--tags wivwav --limit <mini>`, `--check --diff` first. ansible-playbook is installed locally (/opt/homebrew/bin).
  Tailscale subnet router + Caddy already exist there.
- WivWav: releases `deploy-<sha>` exist (latest a8086a8, CI green). Images on GHCR are PRIVATE (anon pull = 403).
  CI publishes only api/web/ops/migrate — NO worker image.
- docker-compose.release.yml gotchas: pg-backup bind-mounts ./docker/postgres-backup/backup.sh (not in asset);
  compose interpolates ALL services so env needs NEXT_PUBLIC_API_URL, OPS_ADMIN_USERNAME, OPS_ADMIN_PASSWORD,
  OPS_SESSION_SECRET too; web/ops have no profile -> always name services:
  `postgres pg-backup valkey meilisearch migrate api`. Override file must be passed with explicit -f.
- Worker: WORKER_TOKEN; local compose defaults it to INTERNAL_API_SECRET (confirm coordinator check in apps/api).
- Registry: only ebay-motors default-disabled; mobility-van-sales would crawl on first boot (ToS forbids automation).

## User decisions (answered 2026-10-13)
- MVS: ALLOW. Start DB FRESH. Off-site: Cloudflare R2. GHCR: user creates classic PAT read:packages.
- Defaults taken: manual Ansible deploy first, timer later; shared box OK (user said execute); caps as listed.

## Original decision list
1. Create classic GitHub PAT with read:packages only (for the mini to pull GHCR) — user action.
2. MobilityVanSales: allow or disable before first boot?
3. Start DB fresh or restore local dev dump (has history)?
4. Deploy trigger: manual Ansible run first; auto-pull timer later (with pg_dump before migrate)?
5. Confirm OK to run on the shared box; memory caps (PG 768M, Meili 512M, API 512M, Valkey 128M, noeviction).
6. Off-site target: Cloudflare R2 or Backblaze B2 (user creates bucket + key).

## Units
| # | Unit | Repo | Worker | Status |
|---|------|------|--------|--------|
| U1 | Add worker image to CI matrix + release; job-runner service under profile in prod compose | WivWav (issue+worktree via run-sprint) | sonnet sprint worker | todo |
| U2 | Ansible role `wivwav` + stacks/wivwav: env from vault, override (mem caps, service list), backup.sh, ghcr login, manifest fetched on controller | macmini-server | Claude (me) or sonnet | todo |
| U3 | Off-site backup: rclone push of postgres_backups to R2/B2 | macmini-server (+ backup-restore.md doc) | sonnet | todo, needs decision 6 |
| U4 | Laptop worker pointed at http://192.168.2.100:3001 (check UniFi VLAN reachability read-only) | ops | me | todo |
| U5 | Reviews: codex (different vendor) on U1 diff and U2 role; /code-review low on PRs | both | codex via ~/.agents/bin/ask | todo |

## Tests (both sides)
- WivWav: CI test that rendered release compose + minimal service list passes `docker compose config --quiet`;
  worker image builds and passes smoke in CI; existing scripts/release-manifest.sh selftest.
- Server: scripts/check.sh (lint/syntax), `--check --diff`, role post-deploy asserts (migrate exited 0,
  /health 200, schedules registered), rclone dry-run + a restore check of one dump.
- Done = migrate 0, /health green, schedules registered, laptop worker connected, one source-scrape wrote
  listings, `free -m` sane after 1 h, first dump visible off-site.

## Progress (2026-10-13)
- U1: issue #1145 -> draft PR #1146 (worker image publish + profile-gated job-runner, WORKER_TOKEN :? required, shm_size/mem/cpus limits, selftest). Codex review fixes applied (ecd90b84). /code-review low running; CI running.
- U2: macmini-server roles/wivwav + stacks/wivwav + scripts/test-wivwav-stack.sh written, UNCOMMITTED (repo has other session's edits; stage only wivwav files + our hunks of playbook.yml/home.example.yml).
  Secrets generated + vault-encrypted into group_vars/home.yml (wivwav: block). Missing: ghcr_username, ghcr_token (user PAT), r2 block.
  Tests: scripts/test-wivwav-stack.sh <sha> OK; check.sh OK; --check --diff vs macmini OK up to compose validate (now skipped in check mode).
  Codex review (10 findings) all addressed.
- U3: rclone sidecar ready, gated on wivwav.r2 (user creates R2 bucket + key).
- Next: user PAT -> real deploy with -e wivwav_release=a8086a8edaccf0861eaff55dcd95d2e126e16365 -> asserts -> laptop worker (make worker-remote N=1 WORKER_COORDINATOR_URL=http://192.168.2.100:3001 WORKER_TOKEN=<internal_api_secret>) -> confirm scrape writes.

## Progress (2026-10-14) - resume here
- U1 DONE: PR #1146 merged (worker image + profile-gated job-runner).
- Vault (macmini-server group_vars/home.yml, `wivwav:` block) now COMPLETE and verified by length: github_container_registry_username/token (40), cloudflare_r2_account_id/access_key_id/secret_access_key (32/32/64), cloudflare_r2_api_token. Keys were renamed from ghcr_/r2_/cf_ to spelled-out names (user dislikes abbreviations). Backup of old home.yml in the scratchpad.
- Cloudflare: NEW account "Cloudflare@wav.vin's Account" (id bbc9d649d0e4bb051e089cb16880ad37), email via Cloudflare Email Routing alias on wav.vin. R2 activated, bucket `wivwav-backups` created, S3 list test = 200. S3 creds = token id + SHA-256(token value); revoking the Cloudflare token breaks off-site backup (swap to a bucket-scoped R2 token later). Token expires 2026-12-01. 2FA on that account not confirmed.
- U2 role fixed: pull/start/migrate/assert/health tasks now skip in --check. `--check --diff` against macmini passes (ok=10 failed=0). scripts/test-wivwav-stack.sh passes.
- macmini-server changes are still UNCOMMITTED (stage only wivwav files + our hunks of playbook.yml/home.example.yml; ask before committing).
- NEXT: real deploy was blocked by the permission classifier (Production Deploy). Run it in a terminal (or add a Bash permission rule):
  cd ~/Projects/Server/macmini-server && ansible-playbook -i inventory.ini playbook.yml --vault-password-file vault-password.txt --tags wivwav --limit macmini -e wivwav_release=a8086a8edaccf0861eaff55dcd95d2e126e16365
  Then: confirm migrate exit 0, /health 200, schedules registered, `free -m` sane; U4 laptop worker (make worker-remote N=1 WORKER_COORDINATOR_URL=http://192.168.2.100:3001 WORKER_TOKEN=<internal_api_secret>); confirm a scrape writes listings; confirm first dump lands in R2; then U5 reviews, commit macmini-server changes, revoke/replace Cloudflare token.
- Notes: `!` shell cannot run ansible/vault-set (blocking IO) - use a real terminal tab. Decrypting vault values to display them is blocked by the classifier; length checks are fine.

## Progress (2026-10-14 evening) - first real deploy
- Deploy ran. Image pull + migrate OK; postgres, valkey, pg-backup, rclone healthy/up.
- ROOT CAUSE of failures: Mac Mini CPU is an Intel Core 2 Duo P8600 (2008): no SSE4.2/POPCNT/AVX. Prebuilt binaries needing x86-64-v2 crash:
  * Meilisearch v1.45.2 -> SIGILL (exit 132). DONE: removed from wivwav_services, api depends_on reset via override (`meilisearch: !reset null`), test script asserts it. API only warns when Meilisearch is absent.
  * API -> crashes at start: `sharp` prebuilt "requires v2 microarchitecture". sharp is imported statically in apps/api/src/images/image-hasher.ts and cli-image-analysis-provider.ts (used only for image hashing/analysis).
- wivwav-api-1 and wivwav-meilisearch-1 are STOPPED with restart=no (they were crash-looping).
- Permission rule `Bash(ansible-playbook * --tags wivwav *)` added by the user; the deploy ran from this session.
- NEXT: app fix (issue + worktree + PR via run-sprint): lazy-load sharp (dynamic import inside the functions) so the API boots without it; image features off/failing gracefully on this host. Then new release, redeploy, run `docker update --restart=unless-stopped wivwav-api-1` is handled by compose up. Longer term: a newer always-on host; later a database browser tool for humans (user wants one).
- 2026-10-14 night: issue #1147 -> draft PR #1148 (lazy-load sharp), full gate green (typecheck/lint/build/test 26/26). /code-review low running. Worktree .claude/worktrees/issue-1147-... still present; remove after review (git worktree remove --force, prune). NEXT: fix any review findings, mark ready, `gh pr merge 1148 --auto --rebase` after user approval, cut release, redeploy.
- 2026-10-14 night (later): PR #1148 has 2 commits (lazy sharp + keep failure message per Codex review). Both /code-review low runs reviewed the wrong diff (main checkout); Codex reviewed the real diff. Worktree removed. NEXT: user marks PR ready -> `gh pr merge 1148 --auto --rebase` -> new release -> redeploy to the Mini (permission rule allows it).

## Progress (2026-10-15) - STACK IS LIVE on the Mac Mini
- PR #1148 merged (lazy sharp). Release deploy-008d11265dba662aee27619497a772294b2fd892 deployed: migrate 0, API healthy, /health 200 (overall status "down" only because Meilisearch is not deployed), schedules running, API ~132 MiB, ~3.3 GB available on the Mini.
- Second root cause fixed in macmini-server stacks/wivwav/env.production.j2: OLLAMA_BASE_URL="" from the release compose is rejected by the API config; set OLLAMA_BASE_URL=http://localhost:11434 (macmini-server change, UNCOMMITTED).
- Issues filed: #1149 (uncaughtException handler exits silently - cost us the debugging), #1150 (empty OLLAMA_BASE_URL should count as unset). Both status:ready.
- Debug tip: ansible ad-hoc on the Mini needs `-e @group_vars/home.yml -b`; put docker format strings in a script file and use `-m ansible.builtin.script` (braces clash with Jinja).
- Postgres + Valkey + pg-backup + rclone up ~2h. First dump copied to R2: NOT yet confirmed.
- NEXT: confirm first R2 dump; start laptop worker (U4): needs WORKER_TOKEN from vault (wivwav.internal_api_secret) without printing it; `make worker-remote N=1 WORKER_COORDINATOR_URL=http://192.168.2.100:3001`; confirm a scrape writes listings. Then commit macmini-server changes (ask first), U5 reviews, replace Cloudflare token, 2FA on Cloudflare account.
- 2026-10-15 01:25 UTC: LAPTOP WORKER CONNECTED. `wivwav-job-runner-1` (OrbStack, 1 concurrent job) dials ws://192.168.2.100:3001; API dispatches and the worker completes jobs (200). Started via a script that reads internal_api_secret from the vault without printing (scratchpad start-worker.sh). tmux session `wivwav` (cwd macmini-server) exists for shared terminal use: `tmux attach -t wivwav`.
- First R2 copy confirmed (wivwav-20261014T230302Z.dump).
- DB at 01:25 UTC: 7 sources (eBay disabled), 0 listings, 0 raw_pages. Source crawl schedules (cronExpression, UTC box): BLVD 0 */6, MobilityWorks 0 */8, others 0 */12 -> first crawls ~06:00 / 08:00 / 12:00 UTC. Done = a crawl writes listings (select count(*) from listings).
- Laptop must stay awake and OrbStack running for the worker to take jobs (caffeinate). Tables: listings, raw_pages, sources, job_run, listing_price_history (snake_case), source cron column "cronExpression".
- 2026-10-15 ~01:40 UTC: FIRST DATA. Added macmini-server `scripts/wivwav-crawl [name...|--list]` (uses existing POST /admin/sources/:id/run with Bearer internal_api_secret from vault; no app change needed). Crawled Freedom Motors via the laptop worker: 164 listings + 164 price-history rows in the Mini's Postgres (raw_pages 0 until detail-crawl runs). "One scrape wrote listings" = DONE.
- Still open: commit macmini-server files (wivwav role/stack/scripts + our hunks of playbook.yml/home.example.yml; leave the other session's edits), U5 reviews, Cloudflare 2FA + bucket-scoped token, laptop must stay awake.
