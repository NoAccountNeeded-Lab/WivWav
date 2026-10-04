// @vitest-environment node
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HelmWorkspace } from './HelmWorkspace'
import { setUrl } from './test-harness'

vi.mock('next/navigation', async () => (await import('./test-harness')).navigationMock)

// The page is server-rendered per request. A browser global used while
// rendering throws here and makes Next fall back to client rendering, which
// browser tests never notice, so cover it in a DOM-less environment.
describe('Helm server rendering', () => {
  it('renders the overview without browser globals', () => {
    setUrl('')
    const html = renderToString(<HelmWorkspace apiBaseUrl="/api/bff" environment="Development" />)
    expect(html).toContain('Helm')
    expect(html).toContain('Legacy ops')
  })

  it('renders with an inspector selection already in the URL (shared link)', () => {
    setUrl('problem=domain%3Asource_error%3Asource%3As1&source=s1')
    const html = renderToString(<HelmWorkspace apiBaseUrl="/api/bff" environment="Development" />)
    expect(html).toContain('role="dialog"')
    expect(html).toContain('Selection path')
  })
})
