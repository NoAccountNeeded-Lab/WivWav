import { createRequire } from 'module'
import sharedConfig from '@wivwav/config/eslint'

const require = createRequire(import.meta.url)
const i18next = require('eslint-plugin-i18next')

export default [
  ...sharedConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      i18next,
    },
    rules: {
      'i18next/no-literal-string': [
        'warn',
        {
          mode: 'jsx-only',
          // Message keys passed to a translator are not rendered copy. Translators
          // are named `t` or `<scope>T` (e.g. `commonT`) by convention.
          callees: {
            exclude: [
              't',
              'i18n(ext)?',
              'require',
              'addEventListener',
              'removeEventListener',
              'getElementById',
              'dispatch',
              'includes',
              'indexOf',
              'endsWith',
              'startsWith',
              'searchParams\\.get',
              'toggleArray',
              'rendererFor',
              '\\w+T',
              't\\.\\w+',
              '\\w+T\\.\\w+',
            ],
          },
          // Style and chart-config object keys (not copy).
          'object-properties': {
            exclude: [
              '[A-Z_-]+',
              'fill',
              'stroke',
              'cursor',
              'notation',
              'position',
              'outline\\w*',
            ],
          },
          'jsx-attributes': {
            exclude: [
              'className',
              'id',
              'href',
              'src',
              'data-\\w+',
              // Non-text ARIA attributes only; aria-label, aria-valuetext and
              // aria-roledescription are accessible names and must be localized.
              'aria-(hidden|live|atomic|relevant|busy|describedby|labelledby|controls|owns|haspopup|expanded|current|selected|checked|pressed|modal|orientation|level|valuemin|valuemax|valuenow|setsize|posinset|disabled|required|invalid|multiline|multiselectable|autocomplete)',
              // Layout and chart (recharts/SVG) configuration, not rendered copy.
              'type',
              'rel',
              'target',
              'role',
              // Component configuration props that carry identifiers, not copy.
              'defaultTab',
              'categories',
              'labelId',
              'projection',
              // Option and control values are machine identifiers; visible labels are children.
              'value',
              'style',
              'dataKey',
              'xAxisId',
              'yAxisId',
              'layout',
              'orientation',
              'stroke\\w*',
              'fill\\w*',
              'viewBox',
              'd',
              'width',
              'height',
              'cx',
              'cy',
              'r',
              'x',
              'y',
            ],
          },
        },
      ],
    },
  },
  {
    // Test fixtures and assertions use literal English on purpose.
    files: ['**/*.test.{ts,tsx}', 'e2e/**'],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
]
