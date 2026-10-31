import { describe, expect, it } from 'vitest'
import { colorFamily, groupColors, toggleMembers } from './color-families'

describe('color families', () => {
  it('maps raw colors to compact families by earliest keyword and leaves unknowns raw', () => {
    expect(colorFamily('Pearl White Tricoat')).toBe('white')
    expect(colorFamily('Dark Charcoal Gray')).toBe('gray')
    expect(colorFamily('Burgundy')).toBe('red')
    expect(colorFamily('Magenta')).toBeNull()
  })

  it('matches whole words only, so substrings never misfile a color', () => {
    expect(colorFamily('Titanium Gray')).toBe('gray')
    expect(colorFamily('Tangerine')).toBeNull()
    expect(colorFamily('Sandstone')).toBeNull()
    expect(colorFamily('Jetstream')).toBeNull()
    expect(colorFamily('Dark-Blue')).toBe('blue')
  })

  it('sums counts per family, keeps raw members, orders common first, and keeps selected raw values', () => {
    const { bars, members } = groupColors(
      [{ value: 'Burgundy', count: 2 }, { value: 'Red', count: 3 }, { value: 'Magenta', count: 1 }, { value: 'Black', count: 9 }],
      ['Maroon'],
    )
    expect(bars.map((b) => [b.value, b.count])).toEqual([['black', 9], ['red', 5], ['Magenta', 1]])
    expect(members.red).toEqual(['Burgundy', 'Red', 'Maroon'])
    expect(members.Magenta).toEqual(['Magenta'])
  })

  it('toggles every raw member in or out, preserving an existing raw-color link', () => {
    expect(toggleMembers([], 'red', ['Burgundy', 'Red'])).toEqual(['Burgundy', 'Red'])
    expect(toggleMembers(['Burgundy', 'Blue'], 'red', ['Burgundy', 'Red'])).toEqual(['Blue'])
    expect(toggleMembers(['A'], 'B')).toEqual(['A', 'B'])
  })

  it('excludes zero-count ghosts from members but keeps selected zero-count values', () => {
    const { members, bars } = groupColors(
      [{ value: 'Red', count: 3 }, { value: 'Burgundy', count: 0 }, { value: 'Maroon', count: 0 }],
      ['Maroon'],
    )
    expect(members.red).toEqual(['Red', 'Maroon'])
    expect(bars).toEqual([{ value: 'red', count: 3 }])
  })
})
