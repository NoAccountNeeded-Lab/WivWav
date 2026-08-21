# WivWav Codex Skills Evaluation

Date: 2026-08-20
Status: Evaluated and revised — four custom cross-agent skills implemented, plus one reviewed and
pinned external adoption (`impeccable`, issue #992 — see "Impeccable adoption" below).

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

### Cross-agent format decision

The shared `SKILL.md` contract is the portable Agent Skills core: required `name` and
`description` fields followed by Markdown instructions. This is the intersection documented by
the [Agent Skills specification](https://agentskills.io/specification),
[OpenAI](https://learn.chatgpt.com/docs/build-skills), and
[Claude Code](https://code.claude.com/docs/en/skills).

Claude Code supports additional top-level fields such as `user-invocable` and
`disable-model-invocation`, but they are Claude extensions rather than portable Agent Skills
fields. Codex-specific presentation belongs in `agents/openai.yaml`. Therefore the three skills
evaluated below use only `name` and `description` in shared frontmatter and place Codex display
metadata in `agents/openai.yaml`. Claude ignores that product-specific file and follows the same
`SKILL.md` through the `.claude/skills/` symlink.

The trade-off is deliberate: the three knowledge/workflow skills remain visible for direct use in
Claude's `/` menu instead of using `user-invocable: false`. Their behavior is safe to invoke
directly, and mandatory workflow constraints remain in `AGENTS.md`, which applies even when an
agent does not load skills.

### Re-evaluation of the three implemented skills

An implementation review found the following issues and resolved them in this branch:

| Skill | Finding | Resolution |
| --- | --- | --- |
| All three | Missing required `name`; Claude-only `user-invocable` prevented strict portable validation | Added matching `name` fields and removed product-specific shared frontmatter |
| `wav-new-package` | The build-stage checklist accidentally included manifest-only `docker/dev` | Split `docker/dev` into a manifest-only step and made other build behavior follow each Dockerfile's existing pattern |
| `wav-new-package` | New deployable services omitted production and conditional E2E Compose wiring | Added `docker-compose.prod.yml`, conditional `e2e/docker-compose.e2e.yml`, and CI build/smoke/artifact/publish checks |
| `wav-prisma-migration` | Migration commands could target an arbitrary `DATABASE_URL`; the phased `NOT NULL` guidance did not distinguish a data-only backfill | Added a fail-closed local-database check before creation, application, or drift commands; credentials must not be printed; data-only backfills now use an explicit `--create-only` draft |
| `wav-add-scraper-source` | Claimed integration tests were offline and implied universal fixture/gold coverage | Distinguished offline unit/fixture checks from authorized live-network integration tests and documented current source-specific coverage |
| All three | No Codex UI metadata | Added optional `agents/openai.yaml` files without changing Claude behavior |

Issue #984 originally called the Prisma and scraper skills follow-on work. The user explicitly
expanded its scope on 2026-08-20; its acceptance criteria now cover all three skills and their
cross-agent compatibility.

A read-only forward test exercised package scaffolding, a required Prisma field with an unknown
database host, and a new scraper without live-network permission. The skills selected the expected
files and checks, stopped before unsafe database or network actions, and exposed one ambiguity that
was corrected: data-only Prisma backfills now explicitly create and edit an empty migration draft.

### 1. Recommended skills, ranked

1. **`gh-address-comments`** — highest alignment: maps directly onto the `[CRITICAL]`/`[WARNING]`/
   `[SUGGESTION]` conventions and coherent-commit rules already in `AGENTS.md`. Low risk (reads PR
   state, proposes diffs, still goes through normal commit/push).
2. **`gh-fix-ci`** — high value, but should be scoped to *diagnose and point at* `pnpm check:affected`
   / the failing Turbo task rather than free-form CI archaeology, so it doesn't duplicate or fight
   the existing `check:affected` iteration loop.
3. **`wav-add-scraper-source`** (custom) — fills a real, currently undocumented-as-a-workflow
   gap: `.claude/instructions.md` states the `SourceAdapter` contract and AI-remap confidence rule
   as facts, not as a scaffolding procedure. **Built** this session — see
   `.agents/skills/wav-add-scraper-source/SKILL.md`. Building it surfaced that `apps/scraper` no
   longer exists (relocated into `apps/api`, `apps/worker`, and `packages/scraper-sources`); three
   `see apps/scraper/...` code comments still pointing at the deleted path
   (`packages/types/src/source-registry.ts`, `packages/search/src/index.ts`,
   `apps/web/src/components/photo-evidence.ts`) were corrected to their real current locations as
   part of this session. `docs/design/scraper-ai-provider-production.md` still references the old
   path but is a dated, point-in-time design record of a past PR — left as historical, not fixed.
4. **`wav-prisma-migration`** (custom) — same gap for `docs/data/schema-conventions.md`; there
   is no `db:reset`, so migration mistakes are costly and currently only guarded by prose. **Built**
   this session — see `.agents/skills/wav-prisma-migration/SKILL.md`.
5. **`wav-api-contract-review`** (custom) — wraps the route/envelope/docs rules already spread
   across `AGENTS.md` and `docs/api-routes.md` into one checkable pass.
6. **`wav-accessibility-qa`** (custom) — real value specifically *for Codex*: `.claude/roles/accessibility.md`
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
  into `wav-accessibility-qa` instead.

### 3. Missing skills

The custom list is otherwise solid. Two more worth naming:

- A **new-package/Dockerfile checklist** — already built this session as `wav-new-package`
  (mirrored to both `.claude/skills/` and `.agents/skills/`). Not in the original proposal, but
  it's exactly the kind of "silent trap, no existing doc" gap the custom skills target.
- `wav-listing-quality-audit` and `wav-observability-change` are good ideas but should be
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
  `wav-*` — they encode rules specific to this repo and must not leak into other projects.
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
3. `wav-add-scraper-source` — **built** this session
4. `wav-prisma-migration` — **built** this session
5. `wav-api-contract-review`
6. `wav-accessibility-qa`

Generic `playwright`, `security-threat-model`, and `sentry` are deferred to a second batch pending
the scoping/permissions decisions above — not because they lack value, but because installing them
unscoped risks conflicting with existing built-container and data-exposure constraints.

### 9. Validation exercise per installed skill

- `gh-address-comments`: run against a real PR with a mix of `[CRITICAL]`/`[WARNING]`/`[SUGGESTION]`
  comments; confirm each thread is resolved or explicitly deferred, not silently dropped.
- `gh-fix-ci`: point at a genuinely red CI run; confirm it identifies the failing Turbo
  package/task and proposes a fix without reaching for `--no-verify` or skipped checks.
- `wav-add-scraper-source`: scaffold against one simple, already-understood target; confirm
  `checkStructure()`/`scrape()`, applicable fixtures/gold cases, and the 0.7 AI-remap check are
  present. Run offline checks first and treat live integration tests as a separately authorized
  step.
- `wav-prisma-migration`: run against a trivial additive migration on the disposable local
  database; confirm it refuses an unknown or remote database target, follows
  `docs/data/schema-conventions.md`, and calls out backfill/rollback even when "not applicable."
- `wav-api-contract-review`: run against a merged PR that already touched routes; confirm it
  would have caught what human review actually caught.
- `wav-accessibility-qa`: run against one existing `apps/web` component; compare its evidence
  output to a Claude accessibility-role pass on the same component.

### 10. Security/maintenance concerns before installation

- The `.agents/skills` gitignore gap (fixed this session) was the real blocker — nothing else
  matters if Codex can't see the skills at all on a fresh checkout.
- Drift between Claude and Codex copies is resolved structurally (symlinks, see #7) rather than by
  convention. Portable shared frontmatter is still a review requirement for every new skill.
- Sentry and any future skill with live external-service access needs explicit read-only scoping
  before install, decided per-skill, not assumed.
- Generic security skills (`security-best-practices`, `security-threat-model`) risk producing
  plausible-but-wrong guidance for WivWav's specific boundaries (`/internal/ops/*` vs `/ops/*`,
  `docs/risk/private-seller-data-policy.md`) unless required to read those docs first — same
  failure mode as any agent operating without repo context.

---

## Impeccable adoption (issue #992)

Adopted a reviewed, pinned subset of the third-party [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
project (Apache-2.0) as a fifth cross-agent skill, `impeccable`, for read-only product-design
critique. Full provenance, the pinned revision (`skill-v4.1.1` / `5a149f3`), the upstream-script
review table, and the update/rollback procedure live in
`.agents/skills/impeccable/PROVENANCE.md`. This section covers the two checks issue #992's
acceptance criteria call for specifically: fresh-checkout discoverability and a read-only
evaluation against a real WivWav mobile shopping surface and a real WivWav ops dashboard.

### Structural pattern reused

`impeccable` follows the exact symlink pattern established above for `wav-*` skills: canonical
content at `.agents/skills/impeccable/SKILL.md`, a relative symlink at `.claude/skills/impeccable`,
and Codex display metadata in `.agents/skills/impeccable/agents/openai.yaml`. No new mechanism was
introduced. Unlike the `wav-*` skills, `impeccable` also ships a `PROVENANCE.md` because it is an
adaptation of external, licensed content rather than a WivWav-original workflow skill.

### Fresh-checkout verification

```
$ git ls-files -s .agents/skills/impeccable .claude/skills/impeccable
100644 ... .agents/skills/impeccable/PROVENANCE.md
100644 ... .agents/skills/impeccable/SKILL.md
100644 ... .agents/skills/impeccable/agents/openai.yaml
120000 ... .claude/skills/impeccable
```

Mode `120000` confirms `.claude/skills/impeccable` is committed as a real symlink, not a copy —
same evidence format used for the four `wav-*` skills above. After committing this branch, a
`git clone`/fresh worktree of it resolves `.claude/skills/impeccable/SKILL.md` through the symlink
(`readlink .claude/skills/impeccable` → `../../.agents/skills/impeccable`, a relative path, so it
works regardless of where the clone lives on disk) and Codex's scan of `.agents/skills/` sees the
same `SKILL.md` plus `agents/openai.yaml` directly, with no drift possible between what the two
agents read.

### Evaluation evidence

Run as read-only critique per `SKILL.md` §4 — source read directly, no scripts, no browser, no
network, no file writes. Both passes are static-code reads, consistent with §2's decision to
exclude live-browser/screenshot automation from this skill entirely.

**Mobile public-shopping surface: `apps/web/src/app/[locale]/discover/DiscoverPage.tsx`**

- `critique` / mode check: this is a Persuade/shop-mode surface per `SKILL.md` §3. It opens with a
  single `<h1>`, active-filter chips, and a two-link CTA row before the filter facets — matches
  `docs/BRAND.md`'s "search and comparison come first" principle; no marketing-style hero or
  decorative section precedes the functional content.
  - `docs/BRAND.md` layout rule ("cards only for repeated listings, modals, and framed tools; do
    not nest cards inside cards") is respected: the filter groups render as plain `<aside>`
    elements, not nested cards.
  - `harden`: primary CTA (`ctaBtn`) and secondary link (`skipLink`) are real `<a>` elements with
    computed `href`s, so they remain usable without JavaScript and have a natural focus order.
    Each filter facet is independently wrapped in `<Suspense>`, giving each an isolated loading
    boundary instead of one page-level blocking spinner — the right shape for
    `docs/BRAND.md`'s "error, loading, empty states need readable text" requirement, though the
    actual fallback content lives in the child components and was not re-verified here (out of
    scope for this skill; `wav-a11y-audit`/the accessibility role owns that check).
  - `audit`: no hardcoded hex colors or ad hoc spacing in this file — it's `styles.*` (CSS module)
    throughout, consistent with the "well-executed CSS module approach" `design-system-audit.md`
    already credits `apps/web` with, not the `filters/[id]/page.tsx` inline-style pattern that
    same audit flags as the worst offender.
  - Responsive/mobile-first: `aria-label`s on each `<aside>` ("Filter by vehicle type and brand",
    etc.) give the three facet groups a distinguishable landmark structure at narrow widths where
    visual grouping alone would be harder to scan — directly serving `docs/BRAND.md`'s mobile-first
    principle rather than a desktop-shrunk layout.

**Dense ops/dashboard surface: `apps/ops/src/app/ops/queues/QueuesClient.tsx`**

- `critique` / mode check: Operate-mode per `SKILL.md` §3 — status chips, per-queue numeric stats,
  and a 15s auto-refresh (`REFRESH_MS`) prioritize scanability over novelty, matching the mode
  description.
- `polish` / state coverage: pause/resume/trigger/sync actions all carry independent
  `loading`/`feedback`/`isError` state (`ActionState`) rendered inline next to the row that
  triggered them, not a single global toast — this keeps the operator's place in a dense list
  instead of forcing them to scan the whole page for feedback, and covers the loading, error,
  and empty (`queues.length === 0`) states `docs/BRAND.md` requires for user-facing states.
- `audit`: every stat and status change routes through `formatCount`/`OpsStatusChip`/
  `RelativeTimestamp` rather than ad hoc inline formatting, so number and time formatting stay
  consistent across the ~19 queue rows this page can render (`QUEUE_META`).
- Accessibility: each `EntityListRow` gets a synthesized `ariaLabel` that spells out status and
  every stat in one string (`"${q.name}, ${status.label}, waiting …, active …, …"`) rather than
  relying on the visually adjacent numbers alone — the right pattern for a screen-reader user
  scanning a dense, live-refreshing table, and it satisfies `docs/BRAND.md`'s "color cannot be the
  only way to communicate status" rule (status is also read as text through `OpsStatusChip`'s
  `label`, not just its `variant` color).
- Responsive/layout: `styles.controlsBar`/`styles.controlsBarRight` group the refresh timestamp
  and three actions (Refresh, Bull Board link, Sync) together; this file only defines behavior, not
  the CSS module's breakpoint rules, so wrap/stacking behavior at narrow ops-viewport widths was
  not verified here — flagged as a gap rather than asserted.

**Conclusion:** both surfaces already follow `docs/BRAND.md`'s rules well; the read-only critique
did not surface a `docs/BRAND.md` violation on either page (consistent with this issue's "no
WivWav UI or brand implementation" scope — no fix was proposed or applied). The one open gap noted
(ops queues CSS-module breakpoint behavior) is a candidate for a future `wav-a11y-audit`/
accessibility-role runtime pass, not an `impeccable` finding, since `impeccable` does not run a
browser.

### Rollback check

Per `PROVENANCE.md`, `rm -rf .agents/skills/impeccable && rm .claude/skills/impeccable` removes the
integration with no other file touched — confirmed by this session: nothing under `apps/`,
`packages/`, `.gitignore`, or any dependency manifest references `impeccable`.

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
