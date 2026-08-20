# WivWav Codex Skills Evaluation

Date: 2026-08-20
Status: Proposal + Claude assessment — no external Codex skills installed yet.

## Purpose

Evaluate which additional Codex skills would materially improve development, testing, review,
security, and operational work in the WivWav repository, and keep Codex and Claude Code skill
coverage consistent.

## Claude's assessment

### Blocking finding: Codex's skill directory was never committed

The proposal states existing skills live under `.agents/skills`. That's correct as a path, but
until this pass it was not a real, shared fact: `.gitignore` ignored `.agents/` wholesale, so the
three `SKILL.md` copies under `.agents/skills/` existed only on one local machine and were never
pushed. Codex's own docs (`https://learn.chatgpt.com/docs/build-skills`, fetched 2026-08-20)
confirm `$REPO_ROOT/.agents/skills` is the real, canonical project-skills path it scans — so
before this fix, **every other checkout, CI runner, and Codex session saw zero WivWav skills**,
regardless of anything in this doc.

Fixed as part of this pass:

- `.gitignore` now ignores `.agents/` contents except `/.agents/skills/` (root only — nested
  `.agents/` directories like `packages/sdlc-cli/.agents/` stay ignored; they're per-run state,
  not skills).
- Committed the three existing skill mirrors plus a new one (`wav-new-package`, added this
  session) under `.agents/skills/`. All four were later renamed from `wivwav-*` to `wav-*` for
  brevity (`wav-create-issue`, `wav-finish-issue`, `wav-run-sprint`, `wav-new-package`).

**Resolved: `.agents/skills/` is now the single source of truth.** Claude Code has no support for
scanning `.agents/skills/` directly — its project-skill lookup is fixed to `.claude/skills/` (plus
`~/.claude/skills/`, nested per-package `.claude/skills/`, and plugin/`--add-dir` sources) — but it
does follow symlinks: a `.claude/skills/<name>` entry can be a symlink to a directory elsewhere on
disk, and Claude Code reads `SKILL.md` through it. Each `.claude/skills/<name>` is now such a
symlink into `.agents/skills/<name>` (`git ls-files -s` shows mode `120000`), so there is exactly
one real `SKILL.md` per skill; editing it updates what both Claude Code and Codex see, with no
possibility of drift.

**Claude-only frontmatter is a no-op for Codex.** `disable-model-invocation` and `user-invocable`
(Claude Code frontmatter fields) are meaningless to Codex — it has its own `$skill-name` explicit
vs. description-match implicit invocation model, with no documented equivalent gating field found
in the fetched docs. If Codex-side gating is wanted (e.g. "only invoke `wav-finish-issue`
explicitly, never automatically"), that needs a Codex-native mechanism — not yet confirmed to
exist — or must stay enforced only by convention in `AGENTS.md` prose, which any agent reads
regardless of skill-loading support.

### 1. Recommended skills, ranked

1. **`gh-address-comments`** — highest alignment: maps directly onto the `[CRITICAL]`/`[WARNING]`/
   `[SUGGESTION]` conventions and coherent-commit rules already in `AGENTS.md`. Low risk (reads PR
   state, proposes diffs, still goes through normal commit/push).
2. **`gh-fix-ci`** — high value, but should be scoped to *diagnose and point at* `pnpm check:affected`
   / the failing Turbo task rather than free-form CI archaeology, so it doesn't duplicate or fight
   the existing `check:affected` iteration loop.
3. **`wivwav-add-scraper-source`** (custom) — fills a real, currently undocumented-as-a-workflow
   gap: `.claude/instructions.md` states the `SourceAdapter` contract and AI-remap confidence rule
   as facts, not as a scaffolding procedure.
4. **`wav-prisma-migration`** (custom) — same gap for `docs/data/schema-conventions.md`; there
   is no `db:reset`, so migration mistakes are costly and currently only guarded by prose. **Built**
   this session — see `.agents/skills/wav-prisma-migration/SKILL.md`.
5. **`wivwav-api-contract-review`** (custom) — wraps the route/envelope/docs rules already spread
   across `AGENTS.md` and `docs/api-routes.md` into one checkable pass.
6. **`wivwav-accessibility-qa`** (custom) — real value specifically *for Codex*: `.claude/roles/accessibility.md`
   already exists but is a Claude Code role construct Codex can't load as a role. Repackaging its
   checklist as a skill gives Codex parity, not just Claude.

### 2. Reject or defer

- **`playwright-interactive`** — defer. AGENTS.md is explicit that the E2E suite is
  "built-container" (`pnpm test:e2e` runs Playwright inside a built container), and WivWav
  separately calls out browser-sandbox safety for the scraper. An interactive/exploratory browser
  skill against real target sites or authenticated sessions needs its own safety review before
  adoption, not a default install.
- **`security-best-practices`** (generic) — reject as a generally-installed skill. It duplicates
  `.claude/roles/reviewer.md`'s existing review checklist (correctness, security, type safety,
  logic, WCAG, API docs) without adding WivWav-specific value, and risks giving guidance that
  doesn't know about the `/internal/ops/*` vs `/ops/*` boundary or the private-seller-data policy
  in `docs/risk/`.
- **`security-ownership-map`** — defer. There is no `CODEOWNERS` file in this repo yet, so there's
  nothing for an ownership-gap analysis to compare against. Premature until ownership policy
  exists.
- **`sentry`** — defer until read-only scoping is explicit. Sentry is present (`apps/api`,
  `apps/web`), so the capability gap is real, but granting an agent Sentry API access needs an
  explicit read-only, no-resolve/no-mute default before install — that's a permissions decision,
  not a skill-content decision.
- **`playwright`** (generic) — partial accept only: useful for authoring/maintaining tests, but
  must defer to the existing built-container `test:e2e` requirement and the accessibility/QA roles
  rather than run its own ad hoc browser sessions. Don't install as-is; wrap with a short WivWav
  note (built-container constraint + `page.evaluate` `function`-not-arrow-const rule) or fold it
  into `wivwav-accessibility-qa` instead.

### 3. Missing skills

The custom list is otherwise solid. Two more worth naming:

- A **new-package/Dockerfile checklist** — already built this session as `wav-new-package`
  (mirrored to both `.claude/skills/` and `.agents/skills/`). Not in the original proposal, but
  it's exactly the kind of "silent trap, no existing doc" gap the custom skills target.
- `wivwav-listing-quality-audit` and `wivwav-observability-change` are good ideas but should be
  built as thin wrappers around the *existing* docs (`docs/ops/runbook-listing-quality-audit.md`,
  `docs/design/observability-architecture.md`) rather than inventing new criteria — lower priority
  than the four above since the underlying knowledge is already written down, just not packaged
  as a procedure.

### 4. Overlap with existing Claude roles

`playwright` / `playwright-interactive` overlap `.claude/roles/tester.md`, `qa.md`, and
`accessibility.md`. `security-best-practices` overlaps `.claude/roles/reviewer.md`'s checklist.
`gh-address-comments` overlaps the review-finding-resolution rules already in `AGENTS.md`
(`## Review` / `## Definition of done`). None of these are reasons to reject outright — they're
reasons the *generic* version of each is lower-value than a WivWav-scoped one, since the
WivWav-scoped rules already exist as the source of truth.

### 5. Should become WivWav-specific

Scraper source addition, Prisma migrations, API contract review, accessibility QA (for Codex
parity), and the new-package/Dockerfile checklist. These all encode repo-specific rules that a
generic skill can't know and that currently only live in prose an agent might skip.

### 6. Global vs. repo-local

- Repo-local (`.agents/skills/` + `.claude/skills/`, both committed): everything prefixed
  `wivwav-*` — they encode rules specific to this repo and must not leak into other projects.
- Global-install candidates: `gh-fix-ci`, `gh-address-comments`, and (once scoped) `sentry` — these
  are generically useful across repos, but should be pointed at `AGENTS.md` for WivWav-specific
  conventions (severity labels, `check:affected`, coherent-commit rules) rather than re-inventing
  them.

### 7. Keeping Codex and Claude consistent

- Fixed: `.agents/skills/` is now committed (see blocking finding above).
- Fixed: `.claude/skills/<name>` are now symlinks into `.agents/skills/<name>` — one real file per
  skill, no drift possible. A new skill only needs a real directory under `.agents/skills/<name>/`
  plus a `.claude/skills/<name>` symlink pointing at it (`ln -s ../../.agents/skills/<name>
  .claude/skills/<name>` from the repo root).
- `AGENTS.md` stays the cross-agent source of truth for anything that must bind regardless of
  which skill system (or none) an agent supports — see the new Dockerfile-checklist line added
  there this session as the pattern to follow.

### 8. First installation batch (≤6)

1. `gh-address-comments`
2. `gh-fix-ci` (scoped to `check:affected`)
3. `wivwav-add-scraper-source`
4. `wav-prisma-migration` — **built** this session
5. `wivwav-api-contract-review`
6. `wivwav-accessibility-qa`

Generic `playwright`, `security-threat-model`, and `sentry` are deferred to a second batch pending
the scoping/permissions decisions above — not because they lack value, but because installing them
unscoped risks conflicting with existing built-container and data-exposure constraints.

### 9. Validation exercise per installed skill

- `gh-address-comments`: run against a real PR with a mix of `[CRITICAL]`/`[WARNING]`/`[SUGGESTION]`
  comments; confirm each thread is resolved or explicitly deferred, not silently dropped.
- `gh-fix-ci`: point at a genuinely red CI run; confirm it identifies the failing Turbo
  package/task and proposes a fix without reaching for `--no-verify` or skipped checks.
- `wivwav-add-scraper-source`: scaffold against one simple, already-understood target; confirm
  `checkStructure()`/`scrape()`, fixtures, and the 0.7 AI-remap threshold are all present.
- `wav-prisma-migration`: run against a trivial additive migration; confirm it follows
  `docs/data/schema-conventions.md` and calls out backfill/rollback even when "not applicable."
- `wivwav-api-contract-review`: run against a merged PR that already touched routes; confirm it
  would have caught what human review actually caught.
- `wivwav-accessibility-qa`: run against one existing `apps/web` component; compare its evidence
  output to a Claude accessibility-role pass on the same component.

### 10. Security/maintenance concerns before installation

- The `.agents/skills` gitignore gap (fixed this session) was the real blocker — nothing else
  matters if Codex can't see the skills at all on a fresh checkout.
- Drift between mirrors is resolved structurally (symlinks, see #7) rather than by convention, so
  there's nothing left to enforce here going forward.
- Sentry and any future skill with live external-service access needs explicit read-only scoping
  before install, decided per-skill, not assumed.
- Generic security skills (`security-best-practices`, `security-threat-model`) risk producing
  plausible-but-wrong guidance for WivWav's specific boundaries (`/internal/ops/*` vs `/ops/*`,
  `docs/risk/private-seller-data-policy.md`) unless required to read those docs first — same
  failure mode as any agent operating without repo context.

---

## Original proposal

Please independently assess these recommendations, identify overlap with existing Claude
workflows, and suggest additions or removals.

### What Codex skills are

A Codex skill is a reusable workflow package containing:

- A required `SKILL.md` with instructions and metadata
- Optional executable scripts
- Optional reference documentation
- Optional templates and other assets

Codex can activate a skill explicitly, such as with `$skill-name`, or automatically when a request
matches the skill's description.

Official documentation: `https://learn.chatgpt.com/docs/build-skills`

Skills may be installed globally for Codex or stored inside a repository as project-specific
skills.

### Existing WivWav skills

WivWav currently has these project-specific skills under `.agents/skills`:

1. `wivwav-create-issue` — creates structured GitHub issues with WivWav labels and attribution.
2. `wivwav-run-sprint` — prepares and executes WivWav worker sprints.
3. `wivwav-finish-issue` — validates, commits, pushes, and opens or updates a draft PR.

### Relevant repository characteristics

- TypeScript pnpm monorepo managed with Turborepo
- Next.js web and operations applications
- Fastify API
- PostgreSQL and Prisma
- Vitest unit and integration tests
- Playwright end-to-end and accessibility tests
- Browser-driven data scrapers
- Sentry instrumentation in the API and web app
- Queue and worker infrastructure
- Mobile-first and WCAG 2.1 AA requirements
- Strict issue, branch, review, and acceptance-evidence workflow
- API route documentation requirements
- Security-sensitive internal operator APIs
- Strong requirements around scraper browser sandboxing
- Existing Claude reviewer, QA, accessibility, performance, and documentation roles

### Recommended curated skills (as proposed)

1. `playwright` — high priority
2. `playwright-interactive` — high priority
3. `gh-fix-ci` — high priority
4. `gh-address-comments` — high priority
5. `security-threat-model` — high priority
6. `security-best-practices` — medium–high priority
7. `sentry` — medium–high priority
8. `security-ownership-map` — medium priority

### Proposed custom WivWav skills (as proposed)

- `wivwav-add-scraper-source`
- `wivwav-api-contract-review`
- `wivwav-prisma-migration`
- `wivwav-accessibility-qa`
- `wivwav-listing-quality-audit`
- `wivwav-observability-change`

See "Claude's assessment" above for the evaluated, ranked, and reasoned version of these lists.
