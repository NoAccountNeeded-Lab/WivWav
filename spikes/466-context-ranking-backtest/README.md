# Issue #466 spike: 1K context-ranking backtest and pilot

Throwaway evaluation harness for the #466 decide-with-data spike. Findings
and the go/no-go decision are written up at
[`docs/design/466-context-ranking-backtest.md`](../../docs/design/466-context-ranking-backtest.md) —
read that first. This directory holds the harness that produced it and the
frozen data/results so the analysis is reproducible and auditable.

Plain dependency-free Node ESM scripts (no `package.json`, not wired into
the pnpm workspace) — run directly with `node`. They shell out to `gh` (for
GitHub API data) and local `git` (for repo-tree/blob reads); no other
runtime dependency.

- `scripts/lib/classify-path.mjs` — versioned path-strata classifier
  (source/test/docs/migration/generated/other). Bump `CLASSIFIER_VERSION`
  whenever the rules change.
- `scripts/lib/github.mjs` — `gh` CLI wrappers (merged-PR listing, PR
  file/detail lookup, issue timeline).
- `scripts/lib/git-tree.mjs` — local `git ls-tree`/`git cat-file` helpers to
  read the repo as it existed at an arbitrary commit, with a blob-sha content
  cache shared across every PR snapshot.
- `scripts/lib/token-estimate.mjs` — the `bytes/4` token estimator and a
  regex-based exported-symbol extractor (documented simplification; #469
  must use a real parser).
- `scripts/lib/rank-variants.mjs` — the five ranking variants compared in
  Stage A: `likelyFileHints` (byte-for-byte port of the current
  `packages/sdlc-cli` baseline), token-level `issueKeyword`, regex-import
  `dependencyCentrality`, a linear-fusion `combined`, and a seeded `random`
  control.
- `scripts/lib/map-builder.mjs` — turns any ranked file order into a
  hard-1,000-token-budget packet, identically for every variant
  (unique files first, then round-robin compact symbols, deterministic
  greedy-skip truncation).
- `scripts/lib/stats.mjs` — mean and a seeded bootstrap 95% CI.
- `scripts/extract-corpus.mjs` — builds the frozen corpus
  (`corpus/corpus.json`) from the repo's actual merged, issue-linked PR
  history. Re-run with `--out` pointed elsewhere to refresh without
  overwriting the frozen snapshot this write-up is based on.
- `scripts/enrich-corpus-with-issues.mjs` — second pass that attaches each
  record's linked-issue title/body/labels (the actual ranking input).
- `scripts/stage-a-backtest.mjs` — Stage A offline backtest; writes
  `results/stage-a-results.json`.
- `scripts/stage-b-replay.mjs` — Stage B **replayed** (not live) pilot; see
  its file header and the write-up for why this is a proxy metric, not a
  live-agent trial, and what it explicitly does not measure. Writes
  `results/stage-b-results.json`.

## Reproduce

```bash
node scripts/extract-corpus.mjs --size 120 --scan-limit 500
node scripts/enrich-corpus-with-issues.mjs
node scripts/stage-a-backtest.mjs
node scripts/stage-b-replay.mjs
```

Each stage script also accepts `--corpus`, `--out`, and `--budget` to point
at a different corpus snapshot or token cap.

## Disposition

This is throwaway spike code, not a production package — kept for
methodology reference / re-derivation if a future #469 proposal wants to
reuse or extend the harness. Not covered by CI, not linted as part of the
monorepo's standard checks.
