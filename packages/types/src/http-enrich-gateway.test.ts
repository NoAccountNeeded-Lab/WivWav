import { describe, expect, it } from 'vitest'
import { issuePaths } from './test-helpers/issue-paths.js'
import {
  dealerEnrichJobPayloadSchema,
  dealerEnrichJobResultSchema,
  fuelEconomyMsrpJobPayloadSchema,
  fuelEconomyMsrpJobResultSchema,
  modelResearchJobPayloadSchema,
  modelResearchJobResultSchema,
  nhtsaComplaintsJobPayloadSchema,
  nhtsaComplaintsJobResultSchema,
  nhtsaInvestigationsJobPayloadSchema,
  nhtsaInvestigationsJobResultSchema,
  nhtsaManufacturerCommunicationsJobPayloadSchema,
  nhtsaManufacturerCommunicationsJobResultSchema,
  nhtsaRecallsJobPayloadSchema,
  nhtsaRecallsJobResultSchema,
  nhtsaSafetyRatingsJobPayloadSchema,
  nhtsaSafetyRatingsJobResultSchema,
  vinEnrichJobPayloadSchema,
  vinEnrichJobResultSchema,
} from './http-enrich-gateway.js'

const vehicleModelScopedPayloadSchemas = {
  nhtsaRecallsJobPayloadSchema,
  nhtsaComplaintsJobPayloadSchema,
  nhtsaSafetyRatingsJobPayloadSchema,
  nhtsaInvestigationsJobPayloadSchema,
  nhtsaManufacturerCommunicationsJobPayloadSchema,
  fuelEconomyMsrpJobPayloadSchema,
}

const unscopedPayloadSchemas = {
  vinEnrichJobPayloadSchema,
  modelResearchJobPayloadSchema,
  dealerEnrichJobPayloadSchema,
}

const resultSchemas = {
  nhtsaRecallsJobResultSchema,
  nhtsaComplaintsJobResultSchema,
  nhtsaSafetyRatingsJobResultSchema,
  nhtsaInvestigationsJobResultSchema,
  nhtsaManufacturerCommunicationsJobResultSchema,
  fuelEconomyMsrpJobResultSchema,
  vinEnrichJobResultSchema,
  modelResearchJobResultSchema,
  dealerEnrichJobResultSchema,
}

describe.each(Object.entries(vehicleModelScopedPayloadSchemas))(
  '%s',
  (_name, schema) => {
    it('parses an empty payload (no vehicleModelId scoping)', () => {
      expect(schema.parse({})).toEqual({})
    })

    it('parses a payload scoped to one vehicleModelId', () => {
      const payload = { vehicleModelId: 'vm-1' }
      expect(schema.parse(payload)).toEqual(payload)
    })

    it('rejects an empty vehicleModelId string', () => {
      const result = schema.safeParse({ vehicleModelId: '' })
      expect(issuePaths(result)).toContain('vehicleModelId')
    })
  },
)

describe.each(Object.entries(unscopedPayloadSchemas))('%s', (_name, schema) => {
  it('parses an empty payload', () => {
    expect(schema.parse({})).toEqual({})
  })
})

describe.each(Object.entries(resultSchemas))('%s', (_name, schema) => {
  it('parses a non-negative processed count', () => {
    expect(schema.parse({ processed: 3 })).toEqual({ processed: 3 })
  })

  it('rejects a negative processed count', () => {
    const result = schema.safeParse({ processed: -1 })
    expect(issuePaths(result)).toContain('processed')
  })

  it('rejects a missing processed count', () => {
    const result = schema.safeParse({})
    expect(issuePaths(result)).toContain('processed')
  })
})
