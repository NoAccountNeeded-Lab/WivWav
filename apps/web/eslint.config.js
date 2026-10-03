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
