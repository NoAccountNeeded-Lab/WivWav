// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SkeletonCard, SkeletonChartBox, SkeletonListRow } from './Skeleton'

afterEach(() => {
  cleanup()
})

describe('SkeletonCard', () => {
  it('should render a fixed-dimension placeholder hidden from the accessibility tree', () => {
    const { container } = render(<SkeletonCard />)
    const root = container.firstElementChild
    expect(root).not.toBeNull()
    expect(root?.getAttribute('aria-hidden')).toBe('true')
  })

  it('should render one title bar plus the requested number of body lines', () => {
    const { container } = render(<SkeletonCard lines={3} />)
    // 1 title span + 3 line spans = 4 total placeholder blocks
    expect(container.querySelectorAll('span').length).toBe(4)
  })
})

describe('SkeletonChartBox', () => {
  it('should apply the requested aspect ratio inline so the box reserves its final shape', () => {
    const { container } = render(<SkeletonChartBox aspectRatio="4/1" />)
    const root = container.firstElementChild as HTMLElement
    expect(root.style.aspectRatio).toBe('4/1')
    expect(root.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('SkeletonListRow', () => {
  it('should render the requested number of rows', () => {
    const { container } = render(<SkeletonListRow count={4} />)
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBe(4)
  })

  it('should default to a single row when count is not provided', () => {
    const { container } = render(<SkeletonListRow />)
    expect(container.children.length).toBe(1)
  })
})
