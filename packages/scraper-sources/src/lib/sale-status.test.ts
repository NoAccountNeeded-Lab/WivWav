import { describe, it, expect } from 'vitest'
import { parseSaleStatus } from './sale-status.js'

describe('parseSaleStatus', () => {
  it('returns sold for "Sold" banner text', () => {
    expect(parseSaleStatus('Sold')).toBe('sold')
    expect(parseSaleStatus('SOLD')).toBe('sold')
  })

  it('returns gone for unavailable banner text', () => {
    expect(parseSaleStatus('No Longer Available')).toBe('gone')
    expect(parseSaleStatus('Vehicle Unavailable')).toBe('gone')
  })

  it('returns pending for "Pending Sale" banner text', () => {
    expect(parseSaleStatus('Pending Sale')).toBe('pending')
    expect(parseSaleStatus('PENDING')).toBe('pending')
    expect(parseSaleStatus('Under Contract')).toBe('pending')
  })

  it('returns active when no banner text is present', () => {
    expect(parseSaleStatus('')).toBe('active')
    expect(parseSaleStatus('View Details')).toBe('active')
  })

  it('returns active when banner text is too long to be a status indicator', () => {
    // Prevents false positives from large DOM elements with class names like "sold" or "pending"
    // that contain unrelated paragraph text
    const longText = 'This vehicle has been sold to a new owner and is no longer available for purchase. Please browse our other listings for similar vehicles. We update our inventory daily.'.padEnd(100, ' ')
    expect(longText.length).toBeGreaterThanOrEqual(100)
    expect(parseSaleStatus(longText)).toBe('active')
  })
})
