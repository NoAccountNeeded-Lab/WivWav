// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PhotoGallery } from './PhotoGallery'

afterEach(() => {
  cleanup()
})

const images = [
  'https://dealer.example.com/exterior.jpg',
  'https://dealer.example.com/ramp.jpg',
  'https://dealer.example.com/interior.jpg',
]

describe('PhotoGallery — AI alt text', () => {
  it('falls back to the vehicle-title alt text when no per-image alt is provided', () => {
    render(<PhotoGallery images={images} alt="2022 Toyota Sienna" />)
    const activeImg = screen.getByRole('img', { name: '2022 Toyota Sienna' })
    expect(activeImg).toBeDefined()
  })

  it('renders AI-derived alt text for an image that has it', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageAlts={[null, 'Fold-out wheelchair ramp', null]}
      />,
    )
    // First image is active by default and has no override → falls back to `alt`.
    expect(screen.getByRole('img', { name: '2022 Toyota Sienna' })).toBeDefined()
  })

  it('renders AI-derived alt text as the active slide changes', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageAlts={[null, 'Fold-out wheelchair ramp', null]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByRole('img', { name: 'Fold-out wheelchair ramp' })).toBeDefined()
  })
})

describe('PhotoGallery — category filter chips', () => {
  it('renders no filter chips when imageCategories is absent', () => {
    render(<PhotoGallery images={images} alt="2022 Toyota Sienna" />)
    expect(screen.queryByRole('group', { name: 'Filter photos by category' })).toBeNull()
  })

  it('renders no filter chips when every imageCategories entry is empty', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[null, null, null]}
      />,
    )
    expect(screen.queryByRole('group', { name: 'Filter photos by category' })).toBeNull()
  })

  it('renders an "All" chip plus one chip per distinct category, with All active by default', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[['exterior'], ['ramp'], ['interior']]}
        categoryLabels={{ exterior: 'Exterior', ramp: 'Ramp', interior: 'Interior' }}
      />,
    )
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Ramp' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Exterior' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Interior' })).toBeDefined()
  })

  it('shows only images matching the selected category chip', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[['exterior'], ['ramp'], ['interior']]}
        categoryLabels={{ exterior: 'Exterior', ramp: 'Ramp', interior: 'Interior' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ramp' }))

    expect(screen.getByRole('button', { name: 'Ramp' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    // Only 1 photo now matches → no multi-image nav controls (dots/arrows) render.
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull()
    expect(screen.getByRole('img', { name: '2022 Toyota Sienna' })).toBeDefined()
  })

  it('restores the full image set when "All" is reselected', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[['exterior'], ['ramp'], ['interior']]}
        categoryLabels={{ exterior: 'Exterior', ramp: 'Ramp', interior: 'Interior' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ramp' }))
    fireEvent.click(screen.getByRole('button', { name: 'All' }))

    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true')
    // 3 photos again → multi-image dot navigation is back.
    expect(screen.getByRole('button', { name: 'Next photo' })).toBeDefined()
    expect(screen.getByLabelText('Photo navigation')).toBeDefined()
  })

  it('announces the filtered photo count via an aria-live region for screen-reader users', () => {
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[['exterior'], ['ramp'], ['interior']]}
        categoryLabels={{ exterior: 'Exterior', ramp: 'Ramp', interior: 'Interior' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ramp' }))
    expect(screen.getByText('Showing 1 of 3 photos')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Showing 3 of 3 photos')).toBeDefined()
  })

  it('never renders an out-of-range active slide when switching to a smaller filtered set', () => {
    // Navigate to the 3rd photo (index 2), then switch to a filter that only
    // matches 1 photo — the previously active index would be out of range
    // for one render if not clamped, which would blank every slide's alt.
    render(
      <PhotoGallery
        images={images}
        alt="2022 Toyota Sienna"
        imageCategories={[['exterior'], ['exterior'], ['ramp']]}
        categoryLabels={{ exterior: 'Exterior', ramp: 'Ramp' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))

    fireEvent.click(screen.getByRole('button', { name: 'Ramp' }))
    expect(screen.getByRole('img', { name: '2022 Toyota Sienna' })).toBeDefined()
  })
})

describe('PhotoGallery — unchanged legacy behavior without semantic evidence', () => {
  it('still shows empty/placeholder state for zero images', () => {
    render(<PhotoGallery images={[]} alt="2022 Toyota Sienna" placeholderLabel="No photo available" />)
    expect(screen.getByRole('img', { name: 'No photo available' })).toBeDefined()
  })

  it('still shows single-image state without dots or arrows', () => {
    render(<PhotoGallery images={[images[0]!]} alt="2022 Toyota Sienna" />)
    expect(screen.queryByRole('button', { name: 'Next photo' })).toBeNull()
    expect(screen.queryByLabelText('Photo navigation')).toBeNull()
  })

  it('still supports arrow-button navigation across all images', () => {
    render(<PhotoGallery images={images} alt="2022 Toyota Sienna" />)
    expect(screen.getByLabelText('Photo 1 of 3').getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(screen.getByLabelText('Photo 2 of 3').getAttribute('aria-current')).toBe('true')
  })
})
