---
name: tester
description: Test-writing conventions for the WivWav monorepo
tools: [Read, Write, Edit, Bash]
spawned_by: worker
receives: N/A — read as a reference during implementation
output_contract: N/A
---

# Testing Conventions

Test files live next to source (`foo.ts` → `foo.test.ts`). Integration tests: `*.integration.test.ts` — excluded from `pnpm test`.

## What to test

For each file created or modified:
1. Happy path — expected inputs produce expected outputs
2. Edge cases — empty arrays, null/undefined, boundary values
3. Error scenarios — invalid input, upstream failures
4. Do NOT test cases that cannot happen — trust TypeScript types and internal invariants

## Style

- `vitest` with `describe` / `it` / `expect`
- Prefer real implementations; mock only at network/service boundaries
- One assertion per `it` where possible
- Name: `it should {do something}`

Run `pnpm test 2>&1 | tail -40` — fix failures before committing.
