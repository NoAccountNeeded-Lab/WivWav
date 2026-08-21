# Provenance: `impeccable` skill

## Upstream

- Project: [pbakaus/impeccable](https://github.com/pbakaus/impeccable)
- Pinned revision: tag `skill-v4.1.1`, commit `5a149f3` (2026-08-14)
- License: Apache-2.0 (compatible with `.claude/core.md`'s runtime dependency license rule —
  this is a documentation-only skill, not a runtime dependency, but the same allow-list is used
  here as the bar)
- Upstream path reviewed: `skill/` (specifically `skill/SKILL.src.md`, `skill/agents/`,
  `skill/reference/`, `skill/scripts/`)

This is **not** a vendored copy or a git submodule. `SKILL.md` in this directory is a WivWav-authored,
Apache-2.0-attributed adaptation: it keeps the command taxonomy (audit, critique, layout, typeset,
polish, harden, plus the Persuade/Operate/Read/Experience mode framing) and drops everything that
requires installing scripts, hooks, or network/browser access. This mirrors how `wav-a11y-audit`
was "[a]dapted from [a third-party skill], retargeted" rather than vendored verbatim — see
`.agents/skills/wav-a11y-audit/SKILL.md`.

## What was reviewed and why it's excluded by default

Upstream `skill/scripts/` (reviewed via the pinned tag) contains, among other files:

| File(s) | Behavior | Included here? |
| --- | --- | --- |
| `hook.mjs`, `hook-lib.mjs`, `hook-admin.mjs`, `hook-before-edit.mjs` | Registers a provider-native hook (`.claude/settings.json` / `.cursor/hooks.json` / `.codex/hooks.json`) that runs automatically on file edits | **No.** WivWav skills are invoked explicitly; an auto-firing design hook on every edit is exactly the kind of "unsafe or unnecessary automation" this issue's acceptance criteria call out. |
| `live.mjs`, `live-browser.js`, `live-browser-dom.js`, `live-browser-session.js`, `live-server.mjs`, `live-inject.mjs`, `live-poll.mjs`, `live-commit-manual-edits.mjs`, `modern-screenshot.umd.js` | Puppeteer-driven live browser session: injects code, takes screenshots, and can auto-commit "manual edits" it observed in the browser | **No.** Browser automation belongs to WivWav's own `apps/web/e2e` Playwright suite and the `wav-a11y-audit` skill, both of which already run inside this repo's build/test pipeline with known sandboxing. Auto-committing edits observed in a live browser session is a file-write behavior this issue explicitly requires reviewing and disabling by default. |
| `generate-image.mjs`, `embed-prompt.mjs` | Calls an external image-generation API | **No.** No outbound network calls from this skill. |
| `detect.mjs`, `detect-csp.mjs` | Can scan a live URL (network access) in addition to local files | **No** for the URL-scanning path. The *concept* of deterministic anti-pattern detection is kept as prose guidance in `SKILL.md` §1 (`audit`), applied by reading source directly — no script, no network call. |
| `context.mjs`, `surface-brief.mjs`, `concept-seed.mjs` | Generates/writes `PRODUCT.md`/`DESIGN.md`-style brief files | **No.** `docs/BRAND.md` is WivWav's committed brief; see `SKILL.md` §0. No parallel brief file is generated. |

Net effect: nothing under upstream `skill/scripts/` is present in this repo. `.agents/skills/impeccable/`
contains only `SKILL.md` (guidance), this file, and `agents/openai.yaml` (Codex display metadata,
matching the pattern already used by `wav-add-scraper-source`, `wav-new-package`, and
`wav-prisma-migration`). There is nothing here that executes.

## Cross-agent discovery

- Canonical content: `.agents/skills/impeccable/SKILL.md`.
- Claude Code: `.claude/skills/impeccable` is a relative symlink to `../../.agents/skills/impeccable`
  (`git ls-files -s .claude/skills/impeccable` shows mode `120000`), matching every other WivWav
  skill. Claude Code's project-skill lookup is fixed to `.claude/skills/`, but it follows symlinks
  and reads `SKILL.md` through them — see `docs/design/agent-skills-evaluation.md` for the prior
  research behind this pattern.
- Codex: scans `.agents/skills/` directly per its own docs
  (`https://learn.chatgpt.com/docs/build-skills`); `agents/openai.yaml` supplies Codex-only display
  metadata without changing the shared `SKILL.md` frontmatter (`name` + `description` only, the
  portable intersection of the Agent Skills spec, OpenAI's docs, and Claude Code's skill format).
- No `.gitignore` change was needed: `.agents/skills/` (root only) is already un-ignored — see the
  "Blocking finding" section of `docs/design/agent-skills-evaluation.md`.

See `docs/design/agent-skills-evaluation.md` for the fresh-checkout verification transcript and the
read-only evaluation run against a WivWav mobile shopping surface and a WivWav ops dashboard.

## Update procedure

1. Check upstream tags for a newer `skill-v*` release: `gh api repos/pbakaus/impeccable/tags` or
   the repo's Releases page.
2. Diff the new tag's `skill/SKILL.src.md`, `skill/agents/`, and `skill/reference/` against what
   changed since `skill-v4.1.1` — command list, mode framework, and any new "brief file" behavior.
3. Re-review `skill/scripts/` at the new tag using the same table structure as above; confirm no
   previously-excluded automation (hooks, live browser, network calls, autonomous writes) has been
   folded into a command this skill treats as "read-only critique."
4. Update this file's pinned revision, the reviewed-file table if it changed, and `SKILL.md` §1/§3
   if the command or mode taxonomy changed upstream.
5. Re-run the evaluation in `docs/design/agent-skills-evaluation.md` against the same two surfaces
   (or their current equivalents) before merging the update.

## Rollback / removal

Removing this integration does not touch any application code:

```bash
rm -rf .agents/skills/impeccable
rm .claude/skills/impeccable   # symlink only
```

No `.env`, dependency manifest, hook registration, or `apps/*`/`packages/*` file references this
skill, so removal restores the prior agent configuration exactly — there is no build, lint, or
runtime dependency on it. Confirm with `git status` that only the two paths above changed.
