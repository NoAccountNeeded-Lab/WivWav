import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Runs every story under src/stories/**/*.stories.tsx as a real browser
// test (Playwright/Chromium via @vitest/browser-playwright). Each story's
// `play` function exercises interaction behavior; @storybook/addon-a11y's
// `test: 'error'` parameter (set in .storybook/preview.tsx) fails the test
// on any axe-core violation; visual-regression states are asserted
// explicitly in-story via `expect(...).toMatchScreenshot()` (imported from
// `vitest`, not `storybook/test` — the latter's `expect` doesn't wire in
// `@vitest/browser`'s screenshot matcher). See
// docs/design/ui-boundary-and-ops-workspace.md section 4.
//
// Screenshot baselines land in `src/stories/__screenshots__/`, committed to
// the repo, with an OS-specific filename suffix (`-darwin`, `-linux`, ...).
// This repo's CI runs on `ubuntu-latest` (.github/workflows/ci.yml), so the
// `-darwin` baselines committed alongside this package's initial stories
// were generated on a contributor's Mac and do not yet have a `-linux`
// counterpart. Per this matcher's own "no reference found" behavior (fails
// once, creating the baseline, then passes on the next run against it),
// the first CI run for these stories is expected to fail and needs a
// follow-up commit with the CI-generated `-linux` baselines reviewed and
// added — the same one-time bootstrapping step any new screenshot-based
// visual-regression suite requires. Real regressions after that point are
// caught normally.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
