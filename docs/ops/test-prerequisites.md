# Test prerequisites and deterministic verification

## Browser prerequisites

Two suites launch real Chromium and need the browser installed on the machine
(CI installs it in `.github/workflows/ci.yml`):

- `packages/scraper-sources` (fixture contracts, listing-date and detail
  tests) uses Playwright Chromium.
- `packages/ui-web` runs every Storybook story as a Vitest browser test
  (`@vitest/browser-playwright`), including screenshot assertions.

Install once per machine, and again after a Playwright version bump (a missing
`chromium_headless_shell-<build>` error means the installed build is stale):

```bash
pnpm --filter @wivwav/scraper-sources exec playwright install chromium
```

On Linux also run `playwright install-deps chromium` for the OS libraries.

## Screenshot baselines

Baselines live in `packages/ui-web/src/stories/__screenshots__/` with an OS
suffix (`-darwin`, `-linux`). Rendering differs per OS, so only baselines for
your platform are compared. A missing baseline fails once and writes the file;
review and commit it.

## Deterministic verification

```bash
pnpm verify
```

Runs typecheck, lint, build and test with the turbo cache bypassed (`--force`)
and low concurrency, after deleting `apps/*/.next` so a stale build directory
cannot leak in. Use it for pre-merge verification, especially on small
machines (8GB).

## Why tests failed only in the full suite (#1186)

Turbo runs packages in parallel, and Vitest defaults assume an idle machine.
Root cause is timing under load, not shared state:

- Chromium start-up in `beforeAll` exceeded the 10s hook timeout
  (scraper-sources). Fixed with a 60s hook timeout.
- `toMatchScreenshot` gave up after 5s waiting for a stable capture (ui-web).
  Fixed with a 30s matcher timeout.
- Vite discovered React and MUI lazily, re-optimised mid-run and cancelled
  in-flight imports (ui-web, cold cache such as a fresh worktree). Fixed by
  pre-declaring `optimizeDeps.include`.
- Testing Library `findBy*` / `waitFor` default to 1s (ops, web). Fixed with
  `asyncUtilTimeout: 10_000` in each app's `vitest.setup.ts`.
