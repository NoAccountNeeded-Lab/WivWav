// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import { DonutRenderer } from './DonutRenderer'
import { SwatchesRenderer } from './SwatchesRenderer'
import { BarsRenderer } from './BarsRenderer'
import type { FilterItem } from './types'

afterEach(cleanup)

const item = (value: string, count: number, active = false): FilterItem => ({
  value, label: value.toUpperCase(), count, active, disabled: count === 0 && !active,
})

function withIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ FilterControls: { listingCount: '{count, plural, one {# listing} other {# listings}}' } }}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('DonutRenderer', () => {
  const items = [item('new', 90), item('used', 9), item('tiny', 1), item('gone', 0, true)]

  it('exposes every slice, including tiny and selected zero-count values, as pressed-state buttons', () => {
    const onToggle = vi.fn()
    render(<DonutRenderer items={items} onToggle={onToggle} maxCount={90} />)
    const gone = screen.getByRole('button', { name: /GONE/ })
    expect(gone.getAttribute('aria-pressed')).toBe('true')
    expect(gone.hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: /TINY/ }))
    expect(onToggle).toHaveBeenCalledWith('tiny')
  })

  it('selects from the slice itself, supports multi-selection, and offsets selected slices', () => {
    const onToggle = vi.fn()
    const { container } = render(
      <DonutRenderer items={[item('new', 60, true), item('used', 40, true)]} onToggle={onToggle} maxCount={60} />,
    )
    const paths = container.querySelectorAll<SVGPathElement>('path[class]')
    expect(paths).toHaveLength(2)
    paths.forEach((path) => expect(path.style.transform).toMatch(/translate\((?!0px, 0px)/))
    fireEvent.click(paths[0]!)
    expect(onToggle).toHaveBeenCalledWith('new')
    expect(screen.getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'true')).toBe(true)
  })

  it('keeps colors stable when counts reorder the slices', () => {
    const fills = (rows: FilterItem[]) => {
      const { container, unmount } = render(<DonutRenderer items={rows} onToggle={vi.fn()} maxCount={10} />)
      const map = Object.fromEntries([...container.querySelectorAll('li')].map((li) => [li.textContent, li.querySelector<HTMLElement>('span[aria-hidden]')!.style.background]))
      unmount()
      return map
    }
    const a = fills([item('a', 9), item('b', 5), item('c', 1)])
    const b = fills([item('c', 9), item('b', 5), item('a', 1)])
    expect(a['A9']).toBe(b['A1'])
    expect(a['C1']).toBe(b['C9'])
  })
})

describe('SwatchesRenderer', () => {
  it('names each swatch with its count, shows no native title tooltip, and marks selection with a check', () => {
    const { container } = withIntl(<SwatchesRenderer items={[item('red', 3, true), item('blue', 0)]} onToggle={vi.fn()} maxCount={3} />)
    const red = screen.getByRole('button', { name: 'RED: 3 listings' })
    expect(red.hasAttribute('title')).toBe(false)
    expect(red.getAttribute('aria-pressed')).toBe('true')
    expect(red.querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('button', { name: /BLUE/ }).querySelector('svg')).toBeNull()
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('shows its tooltip on focus', () => {
    withIntl(<SwatchesRenderer items={[item('red', 3)]} onToggle={vi.fn()} maxCount={3} />)
    fireEvent.focus(screen.getByRole('button', { name: /RED/ }))
    expect(screen.getByRole('tooltip').textContent).toBe('RED: 3 listings')
  })
})

describe('BarsRenderer', () => {
  it('marks the selected bar with a non-color checkmark', () => {
    render(<BarsRenderer items={[item('a', 5, true), item('b', 2)]} onToggle={vi.fn()} maxCount={5} />)
    expect(screen.getByRole('button', { name: /A/ }).querySelector('svg')).toBeTruthy()
    expect(screen.getByRole('button', { name: /B/ }).querySelector('svg')).toBeNull()
  })
})
