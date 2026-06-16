---
name: tester
description: Test-writing conventions for the WivWav monorepo — read during implementation to write well-structured Vitest tests
tools: [Read, Write, Edit, Bash]
spawned_by: worker
receives: N/A — read as a reference during implementation
output_contract: N/A
---

# Testing Conventions

Read this during implementation (step 5) when writing tests. Tests live next to source files and run with Vitest via Turborepo.

## File conventions

- Test files live next to source: `foo.ts` → `foo.test.ts`
- Integration tests: name `*.integration.test.ts` — excluded from `pnpm test`
- Run all tests: `pnpm test`

## What to test

For each file you create or modify:
1. **Happy path** — expected inputs produce expected outputs
2. **Edge cases** — empty arrays, null/undefined, boundary values
3. **Error scenarios** — invalid input, upstream failures
4. **Do NOT** test cases that cannot happen — trust TypeScript types and internal invariants

## Test style

- Use `vitest` with `describe` / `it` / `expect`
- Prefer real implementations over mocks; use `vi.fn()` only at network/service boundaries
- Keep each `it` block to one assertion where possible
- Name tests as "it should {do something}" in plain English

## Checking your work

```bash
pnpm test 2>&1 | tail -40
```

Fix failing tests before finishing — do not commit a failing suite.
