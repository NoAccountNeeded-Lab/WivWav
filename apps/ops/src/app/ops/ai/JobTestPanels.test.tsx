// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AgentsTestPanel,
  IntakeTestPanel,
  JobTestPanel,
  RemapTestPanel,
  StructureTestPanel,
} from './JobTestPanels'

const fetchMock = vi.fn()

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Shared behaviours every panel must keep. */
function sharedScenarios(opts: {
  render: () => void
  endpoint: string
  runningLabel: string
  textareaName: string
  okBody: unknown
}) {
  it('should expose a keyboard-reachable native Run test button and a polite status region', () => {
    opts.render()
    const run = screen.getByRole('button', { name: 'Run test' })
    expect(run.tagName).toBe('BUTTON')
    expect(run.getAttribute('type')).toBe('button')
    run.focus()
    expect(document.activeElement).toBe(run)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(screen.getByText('Results will appear here.')).toBeTruthy()
  })

  it('should post to the endpoint with JSON headers', async () => {
    fetchMock.mockResolvedValue(jsonResponse(opts.okBody))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const { url, init } = lastRequest()
    expect(url).toBe(opts.endpoint)
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('should disable inputs and show the running label while pending', async () => {
    let resolve!: (v: unknown) => void
    fetchMock.mockReturnValue(new Promise(r => { resolve = r }))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    const busy = await screen.findByRole('button', { name: opts.runningLabel })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText(opts.textareaName) as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.queryByText('Results will appear here.')).toBeNull()
    resolve(jsonResponse(opts.okBody))
    await screen.findByRole('button', { name: 'Run test' })
  })

  it('should not call fetch when the main input is blank', () => {
    opts.render()
    fireEvent.change(screen.getByLabelText(opts.textareaName), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('should show the HTTP status for a failed response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: { code: 'X', message: 'boom' } }, 502))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('HTTP 502')).toBeTruthy()
  })

  it('should show the error text when the network request rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Error: network down')).toBeTruthy()
  })

  it('should show "Ollama is not running" guidance for a connection error', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ollamaError: 'fetch failed' } }))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Ollama is not running')).toBeTruthy()
    expect(screen.getByText('ollama serve')).toBeTruthy()
  })

  it('should show "Model not found" with a pull command when the model is missing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { ollamaError: 'model not found', _meta: { provider: 'ollama', model: 'qwen3:8b' } } }),
    )
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Model not found')).toBeTruthy()
    expect(screen.getByText('ollama pull qwen3:8b')).toBeTruthy()
  })

  it('should show a generic Ollama error with its message', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ollamaError: 'bad things' } }))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Ollama error')).toBeTruthy()
    expect(screen.getByText('bad things')).toBeTruthy()
  })

  it('should show the offline message when the response is empty', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(
      await screen.findByText('No response from Ollama — check it is running and the model is pulled.'),
    ).toBeTruthy()
  })

  it('should render the meta table with provider, model, base URL and duration', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: { ..._dataOf(opts.okBody), _meta: { provider: 'ollama', model: 'm1', baseUrl: 'http://x:1' } },
      }),
    )
    opts.render()
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Provider')).toBeTruthy()
    expect(screen.getByText('ollama')).toBeTruthy()
    expect(screen.getByText('m1')).toBeTruthy()
    expect(screen.getByText('http://x:1')).toBeTruthy()
    expect(screen.getByText(/^\d[\d,]* ms$/)).toBeTruthy()
  })
}

function _dataOf(body: unknown): Record<string, unknown> {
  return ((body as { data?: Record<string, unknown> }).data) ?? {}
}

describe('IntakeTestPanel', () => {
  const okBody = { data: { filters: { state: 'TX', maxPrice: 40000 }, rawText: '{}' } }
  sharedScenarios({
    render: () => render(<IntakeTestPanel />),
    endpoint: '/api/intake',
    runningLabel: 'Running…',
    textareaName: 'Test description',
    okBody,
  })

  it('should prefill the first sample and fill the textarea when a sample is selected', () => {
    render(<IntakeTestPanel />)
    const ta = screen.getByLabelText('Test description') as HTMLTextAreaElement
    expect(ta.value).toMatch(/^I use a power wheelchair/)
    fireEvent.click(screen.getByRole('button', { name: 'Fill description: Platform lift' }))
    expect(ta.value).toMatch(/^Looking for a minivan with a platform lift/)
  })

  it('should fill a random sample via the Random button', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    render(<IntakeTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Fill description with random sample' }))
    expect((screen.getByLabelText('Test description') as HTMLTextAreaElement).value).toMatch(/^Any entry type is fine/)
  })

  it('should submit the trimmed description and render extracted filters plus the raw response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<IntakeTestPanel />)
    fireEvent.change(screen.getByLabelText('Test description'), { target: { value: '  van in Texas  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('maxPrice')).toBeTruthy()
    expect(lastRequest().body).toEqual({ description: 'van in Texas' })
    expect(screen.getByText('40000')).toBeTruthy()
    expect(screen.getByText('TX')).toBeTruthy()
    expect(screen.getByText('Raw response')).toBeTruthy()
    expect(document.querySelector('pre')?.textContent).toBe(JSON.stringify(okBody, null, 2))
  })

  it('should explain unrecognisable JSON when rawText exists but no filters were extracted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { filters: {}, rawText: 'hello' } }))
    render(<IntakeTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(
      await screen.findByText('No filters extracted — model responded but returned no recognisable JSON.'),
    ).toBeTruthy()
  })
})

describe('StructureTestPanel', () => {
  const okBody = {
    data: {
      fields: [
        { name: 'price', selector: '.listing-price', sample: '$52,995' },
        { name: 'vin', selector: '.vin', sample: null },
      ],
      rawText: '[]',
    },
  }
  sharedScenarios({
    render: () => render(<StructureTestPanel />),
    endpoint: '/api/ai-test/structure',
    runningLabel: 'Analyzing…',
    textareaName: 'HTML to analyze',
    okBody,
  })

  it('should prefill the first sample and swap in another when selected', () => {
    render(<StructureTestPanel />)
    const ta = screen.getByLabelText('HTML to analyze') as HTMLTextAreaElement
    expect(ta.value).toContain('2022 Toyota Sienna')
    fireEvent.click(screen.getByRole('button', { name: 'Fill HTML snippet: Pacifica (dl/dd)' }))
    expect(ta.value).toContain('2021 Chrysler Pacifica')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    fireEvent.click(screen.getByRole('button', { name: 'Fill HTML snippet with random sample' }))
    expect(ta.value).toContain('2019 Dodge Grand Caravan')
  })

  it('should submit the html and render detected fields with an em dash for null samples', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<StructureTestPanel />)
    fireEvent.change(screen.getByLabelText('HTML to analyze'), { target: { value: ' <p>x</p> ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('.listing-price')).toBeTruthy()
    expect(lastRequest().body).toEqual({ html: '<p>x</p>' })
    expect(screen.getByText('$52,995')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('Raw response')).toBeTruthy()
  })

  it('should explain unrecognisable JSON when rawText exists but no fields were detected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { fields: [], rawText: 'hi' } }))
    render(<StructureTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(
      await screen.findByText('No fields detected — model responded but returned no recognisable JSON.'),
    ).toBeTruthy()
  })
})

describe('RemapTestPanel', () => {
  const okBody = {
    data: {
      mappings: [
        { targetField: 'title', selector: '.t', attribute: null, transform: null },
        { targetField: 'price', selector: '.p', attribute: 'data-p', transform: 'parsePrice' },
      ],
      confidence: 0.85,
      notes: 'looks good',
      rawText: '[]',
    },
  }
  sharedScenarios({
    render: () => render(<RemapTestPanel />),
    endpoint: '/api/ai-test/remap',
    runningLabel: 'Remapping…',
    textareaName: 'Updated HTML',
    okBody,
  })

  it('should fill source name, selectors and HTML together from a sample', () => {
    render(<RemapTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Fill sample: Toyota Sienna (redesign)' }))
    expect((screen.getByLabelText('Source name') as HTMLInputElement).value).toBe('VMI Mobility')
    expect((screen.getByLabelText('Previous selectors JSON') as HTMLTextAreaElement).value).toContain('h1.vehicle-title')
    expect((screen.getByLabelText('Updated HTML') as HTMLTextAreaElement).value).toContain('2023 Toyota Sienna')
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    fireEvent.click(screen.getByRole('button', { name: 'Fill sample with random sample' }))
    expect((screen.getByLabelText('Source name') as HTMLInputElement).value).toBe('Mobility Works')
  })

  it('should submit html, parsed previousMappings and sourceName', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<RemapTestPanel />)
    fireEvent.change(screen.getByLabelText('Updated HTML'), { target: { value: ' <b>y</b> ' } })
    fireEvent.change(screen.getByLabelText('Previous selectors JSON'), { target: { value: '[{"a":1}]' } })
    fireEvent.change(screen.getByLabelText('Source name'), { target: { value: ' My Src ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    await screen.findByText('Confidence')
    expect(lastRequest().body).toEqual({ html: '<b>y</b>', previousMappings: [{ a: 1 }], sourceName: 'My Src' })
  })

  it('should fall back to [] for invalid selector JSON and "Test Source" for a blank name', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<RemapTestPanel />)
    fireEvent.change(screen.getByLabelText('Previous selectors JSON'), { target: { value: 'not json' } })
    fireEvent.change(screen.getByLabelText('Source name'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    await screen.findByText('Confidence')
    const { body } = lastRequest()
    expect(body.previousMappings).toEqual([])
    expect(body.sourceName).toBe('Test Source')
  })

  it('should render the mappings table, confidence badge, notes and raw response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<RemapTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    const badge = await screen.findByText('85%')
    expect(badge.getAttribute('data-variant')).toBe('success')
    expect(screen.getByText('data-p')).toBeTruthy()
    expect(screen.getByText('parsePrice')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText('looks good')).toBeTruthy()
    expect(screen.getByText('Raw response')).toBeTruthy()
  })

  it.each([
    [0.5, '50%', 'warning'],
    [0.49, '49%', 'danger'],
    [0.8, '80%', 'success'],
  ])('should map confidence %s to %s with the %s variant', async (confidence, text, variant) => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { ...okBody.data, confidence } }))
    render(<RemapTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect((await screen.findByText(text)).getAttribute('data-variant')).toBe(variant)
  })

  it('should explain unrecognisable JSON when rawText exists but no mappings were returned', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { mappings: [], rawText: 'hi' } }))
    render(<RemapTestPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(
      await screen.findByText('No mappings returned — model responded but returned no recognisable JSON.'),
    ).toBeTruthy()
  })
})

describe('AgentsTestPanel', () => {
  const okBody = { data: { response: 'Step 1: do it' } }
  sharedScenarios({
    render: () => render(<AgentsTestPanel />),
    endpoint: '/api/ai-test/agents',
    runningLabel: 'Planning…',
    textareaName: 'Task description',
    okBody,
  })

  it('should prefill the first sample and swap in another when selected', () => {
    render(<AgentsTestPanel />)
    const ta = screen.getByLabelText('Task description') as HTMLTextAreaElement
    expect(ta.value).toMatch(/^Add a new filter for wheelchair capacity/)
    fireEvent.click(screen.getByRole('button', { name: 'Fill task description: Price history chart' }))
    expect(ta.value).toMatch(/^Add a price history chart/)
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    fireEvent.click(screen.getByRole('button', { name: 'Fill task description with random sample' }))
    expect(ta.value).toMatch(/^Add a price history chart/)
  })

  it('should submit the trimmed task and render the planner response without a raw section', async () => {
    fetchMock.mockResolvedValue(jsonResponse(okBody))
    render(<AgentsTestPanel />)
    fireEvent.change(screen.getByLabelText('Task description'), { target: { value: ' plan it ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run test' }))
    expect(await screen.findByText('Step 1: do it')).toBeTruthy()
    expect(lastRequest().body).toEqual({ task: 'plan it' })
    expect(screen.queryByText('Raw response')).toBeNull()
  })
})

describe('JobTestPanel dispatcher', () => {
  it.each([
    ['intake', 'Test description'],
    ['scraper.structure', 'HTML to analyze'],
    ['scraper.remap', 'Updated HTML'],
    ['agents', 'Task description'],
  ])('should render the panel for job id %s', (jobId, label) => {
    render(<JobTestPanel jobId={jobId} />)
    expect(screen.getByLabelText(label)).toBeTruthy()
  })

  it('should render nothing for an unsupported job id', () => {
    const { container } = render(<JobTestPanel jobId="nope" />)
    expect(container.innerHTML).toBe('')
  })
})
