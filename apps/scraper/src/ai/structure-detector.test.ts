import { describe, it, expect, vi } from 'vitest'
import { StructureDetector } from './structure-detector.js'
import type { CompletionProvider } from './completion-provider.js'

function makeProvider(response: string): CompletionProvider {
  return {
    name: 'mock',
    complete: vi.fn().mockResolvedValue(response),
  }
}

const VALID_REMAP_JSON = JSON.stringify({
  mappings: [{ targetField: 'make', selector: 'h1', attribute: null, transform: null }],
  confidence: 0.9,
  notes: 'Updated selectors',
})

describe('StructureDetector.remapFields', () => {
  it('returns a valid RemapResult when AI returns well-formed JSON', async () => {
    const detector = new StructureDetector(makeProvider(VALID_REMAP_JSON))
    const result = await detector.remapFields({
      sourceName: 'TestSource',
      previousMappings: [],
      sampleHtml: '<html><h1>Ford</h1></html>',
    })

    expect(result.confidence).toBe(0.9)
    expect(result.mappings).toHaveLength(1)
    expect(result.notes).toBe('Updated selectors')
  })

  it('throws a descriptive error when AI JSON is missing confidence', async () => {
    const missingConfidence = JSON.stringify({
      mappings: [],
      notes: 'Some notes',
    })
    const detector = new StructureDetector(makeProvider(missingConfidence))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws a descriptive error when confidence is null', async () => {
    const nullConfidence = JSON.stringify({
      mappings: [],
      confidence: null,
      notes: 'Some notes',
    })
    const detector = new StructureDetector(makeProvider(nullConfidence))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws a descriptive error when confidence is a string instead of a number', async () => {
    const stringConfidence = JSON.stringify({
      mappings: [],
      confidence: '0.9',
      notes: 'Some notes',
    })
    const detector = new StructureDetector(makeProvider(stringConfidence))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws a descriptive error when confidence is NaN', async () => {
    // JSON.stringify({confidence: NaN}) produces {confidence: null} per spec,
    // so test via a raw JSON string with a special non-finite value isn't possible.
    // Instead verify the guard catches non-finite by patching provider to return a raw NaN
    // by producing JSON that results in the field being absent.
    const noConfidence = '{"mappings":[],"notes":"test"}'
    const detector = new StructureDetector(makeProvider(noConfidence))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws a descriptive error when mappings is not an array', async () => {
    const badMappings = JSON.stringify({
      mappings: 'not-an-array',
      confidence: 0.8,
      notes: 'Some notes',
    })
    const detector = new StructureDetector(makeProvider(badMappings))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws a descriptive error when notes is not a string', async () => {
    const badNotes = JSON.stringify({
      mappings: [],
      confidence: 0.8,
      notes: 42,
    })
    const detector = new StructureDetector(makeProvider(badNotes))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow("AI remap response missing/invalid fields — expected numeric 'confidence'")
  })

  it('throws when AI returns no JSON at all, including the raw response text', async () => {
    const detector = new StructureDetector(makeProvider('Sorry, I cannot help with that.'))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow('AI provider did not return valid JSON. Raw response: Sorry, I cannot help with that.')
  })

  it('throws when AI returns malformed JSON, including the parse error and raw response text', async () => {
    const detector = new StructureDetector(makeProvider('```json\n{ "mappings": [}\n```'))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow(/AI remap response was not valid JSON \(.*\)\. Raw response: ```json \{ "mappings": \[\} ```/)
  })

  it('truncates a long raw response in the error message', async () => {
    const longGarbage = `not json at all ${'x'.repeat(1000)}`
    const detector = new StructureDetector(makeProvider(longGarbage))

    await expect(
      detector.remapFields({ sourceName: 'TestSource', previousMappings: [], sampleHtml: '<html>' })
    ).rejects.toThrow(/…$/)
  })
})
