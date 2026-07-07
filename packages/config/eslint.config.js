import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
  },
}, {
  // WCAG 2.1 AA is mandated repo-wide (see .claude/core.md); only .tsx files
  // contain JSX, so scoping here keeps the plugin from running elsewhere.
  ...jsxA11y.flatConfigs.recommended,
  files: ['**/*.tsx'],
  rules: {
    ...jsxA11y.flatConfigs.recommended.rules,
    // Explicit role="list" on <ul>/<ol> is the standard fix for Safari/VoiceOver
    // dropping list semantics once `list-style: none` is applied, so it is not
    // actually redundant for us and shouldn't be flagged.
    'jsx-a11y/no-redundant-roles': ['error', { ul: ['list'], ol: ['list'] }],
  },
})
