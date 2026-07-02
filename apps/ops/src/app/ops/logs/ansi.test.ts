import { describe, expect, it } from 'vitest'
import { ansiToPlainText, parseAnsi } from './ansi'

describe('parseAnsi', () => {
  it('converts the Meilisearch SGR sequence into styled text segments', () => {
    const input =
      '\u001b[2m2026-07-02T02:06:57.887995Z\u001b[0m \u001b[32m INFO\u001b[0m\n' +
      '\u001b[1mHTTP request\u001b[0m method=GET host="meilisearch:7700" route=/health ' +
      'status_code=200 time.busy=84.1µs time.idle=268µs'

    const segments = parseAnsi(input)

    expect(segments.map(segment => segment.text).join('')).toBe(
      '2026-07-02T02:06:57.887995Z  INFO\nHTTP request method=GET ' +
        'host="meilisearch:7700" route=/health status_code=200 ' +
        'time.busy=84.1µs time.idle=268µs',
    )
    expect(segments.find(segment => segment.text.startsWith('2026'))?.style.dim).toBe(true)
    expect(segments.find(segment => segment.text.includes('INFO'))?.style.foreground).toBe('green')
    expect(segments.find(segment => segment.text === 'HTTP request')?.style.bold).toBe(true)
  })

  it('supports combined, reset, and bright SGR styles', () => {
    const segments = parseAnsi('\u001b[1;32mbold green\u001b[22;91mbright red\u001b[0mplain')

    expect(segments[0]).toMatchObject({
      text: 'bold green',
      style: { bold: true, foreground: 'green' },
    })
    expect(segments[1]).toMatchObject({
      text: 'bright red',
      style: { bold: false, foreground: 'bright-red' },
    })
    expect(segments[2]).toMatchObject({
      text: 'plain',
      style: { bold: false, foreground: null },
    })
  })

  it('supports xterm and true-color foreground and background values', () => {
    const segments = parseAnsi(
      '\u001b[38;5;196mindexed\u001b[48;2;12;34;56mbackground\u001b[0m',
    )

    expect(segments[0]?.style.foreground).toBe('rgb(255 0 0)')
    expect(segments[1]?.style.background).toBe('rgb(12 34 56)')
  })

  it('strips non-display terminal controls while preserving safe text', () => {
    const input =
      '\u001b]8;;https://example.com\u0007click\u001b]8;;\u0007' +
      '\u001b[2J<script>alert("text only")</script>\u0000'

    expect(ansiToPlainText(input)).toBe('click<script>alert("text only")</script>')
  })

  it('supports the single-byte CSI form and removes incomplete sequences', () => {
    expect(ansiToPlainText('\u009b32mgreen\u009b0m \u001b[31\u001b]unfinished')).toBe('green ')
  })
})
