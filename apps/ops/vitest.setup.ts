import { configure } from '@testing-library/react'

// findBy*/waitFor give up after 1s by default; under full-suite load (turbo
// runs packages in parallel) renders can take longer than that (#1186).
configure({ asyncUtilTimeout: 10_000 })
