# Issue #852 spike: MUI Core + MUI X Community evaluation

Throwaway prototype code for the #852 spike. **Not** the final
`@wivwav/design-tokens` / `@wivwav/ui-web` foundation packages — those are
built fresh in #853. Findings and the recommendation are written up at
[`docs/design/852-mui-evaluation-spike.md`](../../docs/design/852-mui-evaluation-spike.md).

- `design-tokens/` — `@wivwav/spike-852-design-tokens`, platform-neutral
  semantic tokens as plain data.
- `ui-web/` — `@wivwav/spike-852-ui-web`, MUI-backed provider/theme +
  Button/IconButton/Menu/Dialog/Drawer/Tooltip/DataGrid, with a Storybook
  harness under `ui-web/.storybook/` and stories under `ui-web/src/stories/`.
- `licenses-prod.txt` — raw `pnpm licenses list --prod` output for
  `@wivwav/spike-852-ui-web`.
- `a11y-results.json` — raw output of the automated axe-core + keyboard
  probe described in the write-up's accessibility section.
- `scripts/` — the throwaway Node scripts used to produce the bundle-delta,
  accessibility, and SSR/hydration numbers in the write-up. Each has a
  usage comment at the top; kept for methodology reference / re-derivation,
  not wired into any `package.json` script.

`tsc` (via `typecheck` in each package) only passes once
`@wivwav/spike-852-design-tokens` has been built, since `ui-web` imports its
compiled `dist/index.d.ts`. Use the repo's real entrypoint —
`pnpm --filter @wivwav/spike-852-design-tokens --filter @wivwav/spike-852-ui-web build typecheck`,
or `turbo typecheck --filter=@wivwav/spike-852-ui-web` — rather than a bare
`pnpm --filter <pkg> typecheck`, which skips turbo's `dependsOn: ["^build"]`
graph and fails with a "cannot find module" error.

Once #853 lands its own foundation package, this directory (and the
`spikes/*/*` workspace glob it relies on, in the repo-root
`pnpm-workspace.yaml`) can be deleted.
