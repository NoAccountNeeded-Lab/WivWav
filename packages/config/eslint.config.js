import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'

const RAW_SQL_TAGS = new Set([
  '$queryRaw',
  '$executeRaw',
  '$queryRawUnsafe',
  '$executeRawUnsafe',
])

const AMBIGUOUS_SQL_COLUMNS = [
  'id',
  'status',
  'createdAt',
  'updatedAt',
  'sourceId',
  'vehicleId',
  'listingId',
  'make',
  'model',
  'year',
  'publicationStatus',
  'priceCents',
  'conversionType',
  'listedAt',
  'goneAt',
  'sourceListedAt',
]

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getSqlSource(node) {
  if (node.type === 'TaggedTemplateExpression') {
    const { tag, quasi } = node
    if (
      tag.type === 'MemberExpression'
      && !tag.computed
      && tag.property.type === 'Identifier'
      && RAW_SQL_TAGS.has(tag.property.name)
    ) {
      return quasi.quasis.map((part) => part.value.raw).join('?')
    }
    if (
      tag.type === 'MemberExpression'
      && !tag.computed
      && tag.object.type === 'Identifier'
      && tag.object.name === 'Prisma'
      && tag.property.type === 'Identifier'
      && tag.property.name === 'sql'
    ) {
      return quasi.quasis.map((part) => part.value.raw).join('?')
    }
    return null
  }

  if (
    node.type === 'CallExpression'
    && node.callee.type === 'MemberExpression'
    && !node.callee.computed
    && node.callee.property.type === 'Identifier'
    && RAW_SQL_TAGS.has(node.callee.property.name)
  ) {
    const firstArg = node.arguments[0]
    if (!firstArg) return null
    if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') return firstArg.value
    if (firstArg.type === 'TemplateLiteral') {
      return firstArg.quasis.map((part) => part.value.raw).join('?')
    }
  }

  return null
}

function stripAliasedColumnNames(sql) {
  return sql.replace(/\bAS\s+(?:"[A-Za-z_][\w]*"|[A-Za-z_][\w]*)/gi, '')
}

const sqlQualificationPlugin = {
  rules: {
    'require-qualified-sql-columns': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Require fully qualified ambiguous column references in raw SQL joins',
        },
        schema: [],
        messages: {
          unqualified: 'Fully qualify SQL column "{{column}}" in raw SQL that joins multiple relations.',
        },
      },
      create(context) {
        return {
          TaggedTemplateExpression(node) {
            const sql = getSqlSource(node)
            if (!sql || !/\bjoin\b/i.test(sql)) return
            const sqlToCheck = stripAliasedColumnNames(sql)

            for (const column of AMBIGUOUS_SQL_COLUMNS) {
              const pattern = new RegExp(`(?<![\\w.])(?:"${escapeRegex(column)}"|${escapeRegex(column)})(?![\\w"])`, 'i')
              if (pattern.test(sqlToCheck)) {
                context.report({
                  node,
                  messageId: 'unqualified',
                  data: { column },
                })
              }
            }
          },
          CallExpression(node) {
            const sql = getSqlSource(node)
            if (!sql || !/\bjoin\b/i.test(sql)) return
            const sqlToCheck = stripAliasedColumnNames(sql)

            for (const column of AMBIGUOUS_SQL_COLUMNS) {
              const pattern = new RegExp(`(?<![\\w.])(?:"${escapeRegex(column)}"|${escapeRegex(column)})(?![\\w"])`, 'i')
              if (pattern.test(sqlToCheck)) {
                context.report({
                  node,
                  messageId: 'unqualified',
                  data: { column },
                })
              }
            }
          },
        }
      },
    },
  },
}

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  plugins: {
    wivwav: sqlQualificationPlugin,
  },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    'wivwav/require-qualified-sql-columns': 'error',
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
}, {
  // Per docs/design/ui-boundary-and-ops-workspace.md section 1, @wivwav/ui-web
  // is the only package permitted to import the underlying component vendor
  // (MUI Core / MUI X Community, accepted in #852) or its `@emotion/*`
  // styling engine directly. apps/web and apps/ops must consume the narrow
  // surface @wivwav/ui-web re-exports instead.
  //
  // This is applied unconditionally to every consumer of this shared config
  // rather than scoped by a `files` glob, because flat-config `files`
  // patterns are resolved relative to each package's own working directory
  // (every workspace here runs its own `eslint src` from within that
  // package), so a glob like `apps/web/**` would never match when lint runs
  // from inside apps/web itself. The scoping instead comes from which
  // packages opt into this shared config at all: @wivwav/ui-web
  // intentionally has no eslint.config.js of its own (matching the existing
  // @wivwav/charts convention of a build/typecheck-only package with no
  // lint script), so it never evaluates this rule against its own vendor
  // imports.
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        {
          group: ['@mui/*', '@emotion/*'],
          message: 'Import UI primitives from @wivwav/ui-web instead of the underlying component vendor directly (see docs/design/ui-boundary-and-ops-workspace.md section 1).',
        },
      ],
    }],
  },
})
