// @vitest-environment jsdom
/**
 * Regression coverage for #762: UI text (headings, labels, prose, nav, table
 * chrome) must resolve to the theme's --font-ui face, while data values
 * (IDs, timestamps, log lines, code/payloads) must resolve to --font.
 *
 * jsdom does not substitute CSS custom properties when computing style, so
 * `getComputedStyle(...).fontFamily` returns the literal authored token
 * (e.g. "var(--font-ui)") rather than a resolved font name. That is exactly
 * what these assertions need: proof that each class of element is wired to
 * the correct token, independent of which concrete font a theme assigns it.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import './globals.css'
import dataTableStyles from '../components/DataTable.module.css'
import pageStyles from './ops/page.module.css'
import logsStyles from './ops/logs/logs.module.css'

afterEach(cleanup)

describe('font legibility (#762)', () => {
  it('defaults body text to the sans UI face', () => {
    const { container } = render(<p>prose</p>)
    expect(getComputedStyle(container.querySelector('p')!).fontFamily || getComputedStyle(document.body).fontFamily)
      .toBe('var(--font-ui)')
  })

  it('resolves overview headings and labels to --font-ui', () => {
    const { getByText } = render(
      <>
        <h1 className={pageStyles.heading}>Overview</h1>
        <p className={pageStyles.kicker}>Ops</p>
        <p className={pageStyles.metricLabel}>Queue depth</p>
      </>,
    )
    expect(getComputedStyle(getByText('Overview')).fontFamily).toBe('var(--font-ui)')
    expect(getComputedStyle(getByText('Ops')).fontFamily).toBe('var(--font-ui)')
    expect(getComputedStyle(getByText('Queue depth')).fontFamily).toBe('var(--font-ui)')
  })

  it('resolves overview data values (metric numbers, queue rows, timestamps) to --font', () => {
    const { getByText } = render(
      <>
        <span className={pageStyles.metricValue}>1,204</span>
        <div className={pageStyles.queueBreakdownRow}>row</div>
        <time className={pageStyles.updatedAt}>12:00:00</time>
      </>,
    )
    expect(getComputedStyle(getByText('1,204')).fontFamily).toBe('var(--font)')
    expect(getComputedStyle(getByText('row')).fontFamily).toBe('var(--font)')
    expect(getComputedStyle(getByText('12:00:00')).fontFamily).toBe('var(--font)')
  })

  it('resolves table IDs (the shared .mono utility) to --font', () => {
    const { getByText } = render(<span className={dataTableStyles.mono}>a1b2c3d4</span>)
    expect(getComputedStyle(getByText('a1b2c3d4')).fontFamily).toBe('var(--font)')
  })

  it('resolves log timestamps and message lines to --font', () => {
    const { getByText } = render(
      <>
        <span className={logsStyles.tsCell}>2026-07-23T00:00:00Z</span>
        <span className={logsStyles.msgText}>scrape failed</span>
        <span className={logsStyles.mono}>svc-name</span>
      </>,
    )
    expect(getComputedStyle(getByText('2026-07-23T00:00:00Z')).fontFamily).toBe('var(--font)')
    expect(getComputedStyle(getByText('scrape failed')).fontFamily).toBe('var(--font)')
    expect(getComputedStyle(getByText('svc-name')).fontFamily).toBe('var(--font)')
  })
})
