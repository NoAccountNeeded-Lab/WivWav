// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BarsRenderer, BarsCountLeftRenderer } from './BarsRenderer'
import type { FilterItem } from './types'

const items: FilterItem[] = [
  { value: 'braunability', label: 'BraunAbility', count: 1234, active: false, disabled: false },
]

afterEach(() => {
  cleanup()
})

describe('BarsRenderer', () => {
  it('should render the count after the label by default', () => {
    render(<BarsRenderer items={items} onToggle={vi.fn()} maxCount={1234} />)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('BraunAbility1,234')
  })

  it('should render the count before the label in the count-left variant', () => {
    render(<BarsCountLeftRenderer items={items} onToggle={vi.fn()} maxCount={1234} />)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('1,234BraunAbility')
  })
})
