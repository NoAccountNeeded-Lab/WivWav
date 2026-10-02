import { describe, expect, it } from 'vitest'
import { isVehicleImageElement, isVehicleImageUrl } from './image-filter.js'

function img(attrs: Record<string, string>, natural: { w?: number; h?: number } = {}): HTMLImageElement {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    naturalWidth: natural.w ?? 0,
    naturalHeight: natural.h ?? 0,
  } as unknown as HTMLImageElement
}

describe('isVehicleImageUrl', () => {
  it('accepts ordinary photo URLs', () => {
    expect(isVehicleImageUrl('https://cdn.example.com/photos/123/front.jpg')).toBe(true)
  })

  it.each(['/assets/logo.png', '/img/icon/x.png', '/a/banner.jpg', '/staff/bob.jpg', '/Header/x.png'])(
    'rejects site-chrome path %s',
    (url) => expect(isVehicleImageUrl(url)).toBe(false),
  )

  it('rejects data URIs', () => {
    expect(isVehicleImageUrl('data:image/svg+xml;base64,AAA')).toBe(false)
  })
})

describe('isVehicleImageElement', () => {
  it('accepts a normal image and prefers data-src over src', () => {
    expect(isVehicleImageElement(img({ src: '/p/car.jpg' }))).toBe(true)
    expect(isVehicleImageElement(img({ 'data-src': '/p/logo.png', src: '/p/car.jpg' }))).toBe(false)
  })

  it('rejects chrome URLs and a missing src', () => {
    expect(isVehicleImageElement(img({ src: '/logo/x.png' }))).toBe(false)
    expect(isVehicleImageElement(img({}))).toBe(true)
  })

  it('rejects tiny declared dimensions', () => {
    expect(isVehicleImageElement(img({ src: '/c.jpg', width: '50' }))).toBe(false)
    expect(isVehicleImageElement(img({ src: '/c.jpg', height: '100' }))).toBe(false)
    expect(isVehicleImageElement(img({ src: '/c.jpg', width: '800', height: '600' }))).toBe(true)
  })

  it('rejects tiny natural sizes but ignores unloaded (0) images', () => {
    expect(isVehicleImageElement(img({ src: '/c.jpg' }, { w: 100, h: 300 }))).toBe(false)
    expect(isVehicleImageElement(img({ src: '/c.jpg' }, { w: 300, h: 100 }))).toBe(false)
    expect(isVehicleImageElement(img({ src: '/c.jpg' }, { w: 0, h: 0 }))).toBe(true)
  })
})
