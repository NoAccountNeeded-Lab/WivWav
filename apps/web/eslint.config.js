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
              'aria-\\w+',
            ],
          },
        },
      ],
    },
  },
]
