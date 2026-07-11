import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from '@playwright/test'

type AxeResults = Awaited<ReturnType<InstanceType<typeof AxeBuilder>['analyze']>>
type AxeViolation = AxeResults['violations'][number]

export type TriagedAxeViolation = {
  page: string
  ruleId: string
  owner: string
  reason: string
}

// Issue #673 / decision D9 (#666): every user-facing page must meet WCAG 2.1
// AA. Serious/critical axe violations gate CI; moderate/minor findings are
// reported but not gating. Callers pass their own triage list — waived
// findings need an owner and a reason, never a loosened assertion.
const GATING_IMPACTS = new Set(['serious', 'critical'])

export async function assertNoGatingViolations(
  page: Page,
  pagePath: string,
  triaged: readonly TriagedAxeViolation[] = [],
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()

  const isTriaged = (ruleId: string): boolean =>
    triaged.some((entry) => entry.page === pagePath && entry.ruleId === ruleId)

  const gating = results.violations.filter(
    (violation: AxeViolation) =>
      violation.impact != null &&
      GATING_IMPACTS.has(violation.impact) &&
      !isTriaged(violation.id),
  )

  if (gating.length > 0) {
    const summary = gating
      .map((violation) => {
        const targets = violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n')
        return `- [${violation.impact}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${targets}`
      })
      .join('\n')
    throw new Error(`axe found serious/critical violations on ${pagePath}:\n${summary}`)
  }
}
