# Issue #466: 1K context-ranking backtest and pilot — results and decision

Track A · S1 spike gating #469 (Track B · I1). Evaluates whether a
hard-budgeted, dependency-ranked repository "context map" would beat the
current `likelyFileHints` baseline (`packages/sdlc-cli/src/commands/run-sprint.ts`)
enough to justify building it. Throwaway evaluation harness and raw data live
in [`spikes/466-context-ranking-backtest/`](../../spikes/466-context-ranking-backtest/);
this document is the write-up and decision record.

## Decision

**Cut I1.** Do not build the production ranked-map generator (#469) as
currently scoped. Stage A — the offline ranking backtest — fails decisively:
the proposed "combined" ranking (issue-keyword + dependency-centrality
fusion) does not beat the existing `likelyFileHints` baseline on this repo's
own PR history; if anything it is marginally worse. Per #469's own gate
("If #466 fails Stage A, do not build this issue"), Stage B was not required
to reach a decision, though a replayed (non-live) Stage B pass was still run
for completeness and is reported below with its methodology limitations.

## Why the baseline already wins here

WivWav's own SDLC pipeline writes issue bodies that routinely spell out
literal repo-relative file paths in prose (e.g. "Delete the in-process job
bodies in `apps/scraper/src/jobs/nhtsa-recalls.ts`, `nhtsa-complaints.ts`,
..."). `likelyFileHints`'s whole-string substring match effectively turns
into a near-exact-match grep against that prose. A token-level or
dependency-weighted ranker does not have an obvious advantage over that on
*this* corpus — and diluting the ranking with generic import-centrality
(files everyone imports, e.g. shared types) measurably hurts precision
inside a fixed 1,000-token budget by displacing issue-specific files.

## Corpus

Reproduced with `node spikes/466-context-ranking-backtest/scripts/extract-corpus.mjs --size 120 --scan-limit 500`
against `NoAccountNeeded-Lab/WivWav` on 2026-08-19: the 120 most recent
merged, issue-linked PRs (closing-keyword linked), 1,693 changed files across
them (`added`/`modified`/`renamed`/`removed`), max 116 files in a single PR.

This differs from the issue body's stated "verified corpus" (120 PRs / 1,276
files / max 73 files/PR) — that snapshot predates this run; the repo has
grown since #466 was filed. The frozen, reproducible corpus this report is
based on is committed at
[`spikes/466-context-ranking-backtest/corpus/corpus.json`](../../spikes/466-context-ranking-backtest/corpus/corpus.json)
so the numbers below can be regenerated exactly (`git ls-tree`/`git cat-file`
against the same commit shas) without depending on further repo growth.

113/120 linked issues carried a `status:in-progress` label event usable as a
literal work-start marker (see extraction script header for the marker
methodology); 88/92 evaluable PRs used a marker-backed base snapshot.

Path classifier (`scripts/lib/classify-path.mjs`, version 1): `source` /
`test` / `docs` / `migration` / `generated` (lockfiles, build artifacts,
`node_modules`, `dist`/`build`/`.next`/`coverage`/`.turbo`) / `other`.
Renames score against `previous_filename`, deletions against `filename`;
added files have no pre-change path and are never counted as a ranker miss.
Of the 120 PRs, 92 had at least one pre-existing `source`-strata changed file
and were evaluable (28 touched only test/docs/migration/generated/added
files and are outside this backtest's scope by design).

## Stage A — offline ranking backtest

Reproduce: `node spikes/466-context-ranking-backtest/scripts/stage-a-backtest.mjs`
(reads the frozen corpus, writes
[`results/stage-a-results.json`](../../spikes/466-context-ranking-backtest/results/stage-a-results.json)).
Estimator: `bytes/4` (documented approximation, not a real tokenizer).
Deterministic-rerun check: the full computation was re-run in the same
process and the aggregate JSON compared byte-for-byte — **identical**.

All five variants rank the same source-file candidate universe (repo files
classified `source` at the PR's `baseRefOid`) and are budgeted to the same
hard 1,000-estimated-token cap by one shared `buildMap` (unique files ranked
first, then compact exported-symbol signatures, round-robin across files so
one file's symbols cannot crowd out project coverage). The cap was never
exceeded by any variant across all 92×5 evaluations.

### All-92-PR base (n=92)

| Variant | hit@1K | recall@1K | MRR | unique relevant / 1K tok |
|---|---|---|---|---|
| `likelyFileHints` (current baseline) | 88.0% | 68.0% | 0.444 | 3.87 |
| `dependencyCentrality` (alone) | 47.8% | 28.6% | 0.091 | 1.58 |
| `issueKeyword` (token-level) | 90.2% | 67.9% | 0.398 | 3.84 |
| `combined` (0.6·keyword + 0.4·centrality) | 87.0% | 66.1% | 0.264 | 3.85 |
| `random` control | 54.3% | 14.9% | 0.074 | 1.18 |

Random-control recall (14.9%) sitting far below every real ranking confirms
the harness itself is measuring something meaningful, not noise.

### 100-PR marker-backed sensitivity (n=88, literal work-start snapshot)

| Variant | hit@1K | recall@1K | MRR |
|---|---|---|---|
| `likelyFileHints` | 87.5% | 68.2% | 0.426 |
| `combined` | 86.4% | 66.3% | 0.256 |

Consistent with the all-PR-base result (recall delta -1.9pp there vs -1.9pp
here) — the marker-vs-baseRefOid choice does not change the conclusion.

### Pass/fail against #466's four Stage A conditions (all-92-PR base)

| Condition | Result |
|---|---|
| Combined recall@1K improves ≥10pp over `likelyFileHints` | **Fail** — combined is 1.9pp *worse* |
| Bootstrap 95% CI lower bound for the improvement > 0 | **Fail** — CI = [-7.6pp, +3.5pp], crosses zero |
| Overall hit@1K does not regress; no domain regresses >5pp | **Fail** — hit@1K regresses (88.0%→87.0%); `apps/api` domain recall regresses 57.9%→48.6% (-9.4pp) |
| Cap never exceeded; repeated runs identical | **Pass** |

Overall: **Stage A fails** (1 of 4 conditions passes).

Domain detail (`apps/api`, `packages/config`, `packages/db`,
`packages/types` all regress under `combined`; `apps/ops`, `apps/web` improve
slightly) and risk-tier detail (small ≤5-file PRs regress the most,
93.0%→81.6% recall — combined actively hurts the easy cases the baseline
already nails) are in the full JSON.

Per §"If baseline recall makes +10 points mathematically impossible..." —
that clause does not apply here: +10pp *was* mathematically possible (68.0%
baseline leaves 32pp of headroom); combined simply did not achieve it. No
alternate threshold was substituted after the fact.

## Stage B — replayed pilot (informational; not gating)

Because Stage A failed, #469's own gate already answers the question
("If #466 fails Stage A, do not build this issue") and Stage B was not
required. It was still run, for the acceptance criterion that Stage B be
published, with an important methodology caveat spelled out below and in
the script's header comment
(`spikes/466-context-ranking-backtest/scripts/stage-b-replay.mjs`).

**This is a replayed, proxy-metric analysis over the historical corpus —
not a live multi-agent pilot.** Running a true live pilot (solve real issues
twice, once per condition, with an actual coding agent, measuring completion
rate, review findings, stuck rate, re-review cycles) requires the production
ranked-map generator this would pilot (#469, gated on this very issue) and
real further agent-run compute; it is out of scope for a single automated
spike worker to self-authorize. The replay instead reuses Stage A's rankings
to model "files a worker would open to locate the first changed source
file" under `likelyFileHints` order (today's actual behavior with the map
off) vs. under the `combined` ranked map.

Reproduce: `node spikes/466-context-ranking-backtest/scripts/stage-b-replay.mjs`
→ [`results/stage-b-results.json`](../../spikes/466-context-ranking-backtest/results/stage-b-results.json).

- n = 92, median exploratory-read reduction = **100%**, median read-token
  reduction = **76.9%** — both nominally clear the 15% thresholds.
- **These numbers are structurally biased toward the map and should not be
  read as pilot evidence on their own.** The replay credits the map-on
  condition 0 discovery reads whenever the ranked map surfaces *any*
  ground-truth file, while the native/map-off condition always counts at
  least one read to open the located file — even when it's ranked first.
  A real agent still has to open and read the target file to edit it in
  *both* conditions; the replay only models the discovery step, not that
  shared final read, so the reduction is overstated relative to a live run.
- Not measured by replay at all (published as explicitly unmeasured, not
  guessed): total input tokens through the first green affected check,
  first-pass completion rate, acceptance-criteria coverage, review-finding
  counts, stuck rate, re-review cycle count. These require a real agent
  attempt per condition and were not fabricated for this report.

## Conclusion

Stage A shows the ranking approach evaluated here (issue-keyword + naive
linear-weighted dependency-centrality fusion, hard-budgeted to 1,000
estimated tokens) does not improve on the current `likelyFileHints`
substring-match baseline for this repository's actual issue-writing style,
and measurably hurts the domains and risk tiers where the baseline already
performs best. Building #469 on this ranking design is not justified by the
evidence. Stage B's replayed numbers look favorable but rest on a biased
proxy metric and are explicitly not a substitute for the live-pilot gates
#469 requires (completion rate, review findings, stuck rate) — they do not
change the Stage-A-driven decision.

**#469 is closed as not planned**, referencing this write-up as the
evidence. If a future contributor wants to revisit this, the harness here is
reusable for a fresh ranking design (e.g. reciprocal-rank fusion instead of
linear weighting, or a real TS-compiler-based symbol/dependency graph
instead of the regex approximation used here) — rerun both stage scripts
against a freshly extracted corpus before proposing a new #469.
