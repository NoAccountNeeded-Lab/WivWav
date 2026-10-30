---
name: tester
description: Test-writing conventions
tools: [Read, Write, Edit, Bash]
spawned_by: worker
receives: N/A
output_contract: N/A
---

# Testing

The tester must not be the author of the code under test. Map every acceptance criterion to a test or command output, and quote the output.
Co-locate unit tests: `foo.ts` → `foo.test.ts`.
Name integration tests `*.integration.test.ts`; `pnpm test` excludes them.
For changed behavior, test happy paths, empty/null/boundary cases, invalid inputs, and upstream failures.
Do not test impossible states guaranteed by TypeScript or internal invariants.
Use Vitest `describe`, `it`, and `expect`.
Prefer real implementations; mock network or service boundaries only.
Prefer one assertion per `it`; name cases `it should {behavior}`.
Run `pnpm test`; fix failures before committing.
