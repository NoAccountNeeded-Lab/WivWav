# Plan: UI style guide first (2026-10-16)

Why: workers implementing the UI review (see .claude/plans/ui-review-2026-10-16/) need one rulebook so output is consistent. Nothing is deployed; the Mac Mini is the collector host, not production.

Inputs: ui-review-2026-10-16/{design-critique,data-audit,benchmark,second-opinion-*}.md; docs/BRAND.md (authority; lists seasonal themes that do not exist in code); apps/web/src/app/globals.css tokens.

Steps
1. Draft docs/design/style-guide.md + specimen page (worker: opus, read-only, output to scratch dir). Status: running.
2. Orchestrator review, render specimen, show owner. Codex clean-context review.
3. Owner approves direction (colour, type, card anatomy).
4. One PR: add guide to repo, link from docs/BRAND.md and CLAUDE.md worker role, reconcile BRAND.md with real tokens, add lint-able rules (no font-size < 12px, no raw hex outside tokens) as a follow-up issue.
5. Then file implementation issues by phase (Phase 1 quick wins first).

Owner constraints: icons over words (lucide + accessible names); filters on top then collapse to chips; no left rail; do not copy visor.vin (study only); no watchlist features; not stark/near-black/dated; soft tinted neutrals, fresh hues; plain direct copy; no abbreviations; WCAG 2.1 AA.
