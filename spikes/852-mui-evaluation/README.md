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

Once #853 lands its own foundation package, this directory (and the
`spikes/*/*` workspace glob it relies on, in the repo-root
`pnpm-workspace.yaml`) can be deleted.
