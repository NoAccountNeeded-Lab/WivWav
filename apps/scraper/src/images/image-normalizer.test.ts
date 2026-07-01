import { describe, it, expect } from 'vitest'
import { normalizeImageUrl, isSiteChromeUrl } from './image-normalizer.js'

describe('normalizeImageUrl', () => {
  it('should return data URIs unchanged', () => {
    const dataUri = 'data:image/png;base64,abc123'
    expect(normalizeImageUrl(dataUri)).toBe(dataUri)
  })

  it('should return unparseable URLs unchanged', () => {
    expect(normalizeImageUrl('not-a-url')).toBe('not-a-url')
  })

  it('should strip utm_source tracking param', () => {
    const result = normalizeImageUrl('https://cdn.example.com/img.jpg?utm_source=email&w=800')
    expect(result).not.toContain('utm_source')
    expect(result).toContain('w=800')
  })

  it('should strip all utm_ tracking params', () => {
    const url = 'https://cdn.example.com/img.jpg?utm_source=x&utm_medium=y&utm_campaign=z&w=800'
    const result = normalizeImageUrl(url)
    expect(result).not.toContain('utm_')
    expect(result).toContain('w=800')
  })

  it('should strip fbclid tracking param', () => {
    const result = normalizeImageUrl('https://cdn.example.com/img.jpg?fbclid=abc123&q=90')
    expect(result).not.toContain('fbclid')
    expect(result).toContain('q=90')
  })

  it('should retain content-affecting params', () => {
    const url = 'https://cdn.example.com/img.jpg?w=800&h=600&q=85&fit=crop'
    const result = normalizeImageUrl(url)
    expect(result).toContain('w=800')
    expect(result).toContain('h=600')
    expect(result).toContain('q=85')
    expect(result).toContain('fit=crop')
  })

  it('should sort remaining params for stable output', () => {
    const urlA = 'https://cdn.example.com/img.jpg?w=800&h=600'
    const urlB = 'https://cdn.example.com/img.jpg?h=600&w=800'
    expect(normalizeImageUrl(urlA)).toBe(normalizeImageUrl(urlB))
  })

  it('should produce equal normalized URLs for tracking-only variants', () => {
    const urlA = 'https://cdn.example.com/img.jpg?utm_source=a'
    const urlB = 'https://cdn.example.com/img.jpg?utm_source=b'
    expect(normalizeImageUrl(urlA)).toBe(normalizeImageUrl(urlB))
  })
})

describe('isSiteChromeUrl', () => {
  it('should return true for data URIs', () => {
    expect(isSiteChromeUrl('data:image/png;base64,abc')).toBe(true)
  })

  it('should return true for logo paths', () => {
    expect(isSiteChromeUrl('https://example.com/assets/logo.png')).toBe(true)
  })

  it('should return true for icon paths', () => {
    expect(isSiteChromeUrl('https://example.com/icons/favicon.ico')).toBe(true)
  })

  it('should return true for tracking pixel paths', () => {
    expect(isSiteChromeUrl('https://example.com/tracking/pixel.gif')).toBe(true)
  })

  it('should return true for banner paths', () => {
    expect(isSiteChromeUrl('https://example.com/images/banner.jpg')).toBe(true)
  })

  it('should return true for avatar paths', () => {
    expect(isSiteChromeUrl('https://example.com/staff/avatar.jpg')).toBe(true)
  })

  it('should return false for vehicle image paths', () => {
    expect(isSiteChromeUrl('https://cdn.example.com/vehicles/2020-toyota-camry-1.jpg')).toBe(false)
  })

  it('should return false for gallery paths', () => {
    expect(isSiteChromeUrl('https://cdn.example.com/inventory/12345/photo-1.jpg')).toBe(false)
  })

  it('should return false for unparseable URLs', () => {
    expect(isSiteChromeUrl('not-a-url')).toBe(false)
  })
})
