export type AnsiNamedColor =
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'bright-black'
  | 'bright-red'
  | 'bright-green'
  | 'bright-yellow'
  | 'bright-blue'
  | 'bright-magenta'
  | 'bright-cyan'
  | 'bright-white'

export interface AnsiStyle {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  strikethrough: boolean
  foreground: AnsiNamedColor | string | null
  background: AnsiNamedColor | string | null
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

const ANSI_SEQUENCE = new RegExp(
  [
    '\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\)',
    '(?:\\u001B\\[|\\u009B)([0-?]*)([ -/]*)([@-~])',
    '\\u001B(?!\\[|\\])[@-_]',
  ].join('|'),
  'g',
)

const NORMAL_COLORS: readonly AnsiNamedColor[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
]

const BRIGHT_COLORS: readonly AnsiNamedColor[] = [
  'bright-black',
  'bright-red',
  'bright-green',
  'bright-yellow',
  'bright-blue',
  'bright-magenta',
  'bright-cyan',
  'bright-white',
]

function defaultStyle(): AnsiStyle {
  return {
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    inverse: false,
    strikethrough: false,
    foreground: null,
    background: null,
  }
}

function sameStyle(left: AnsiStyle, right: AnsiStyle): boolean {
  return (
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.inverse === right.inverse &&
    left.strikethrough === right.strikethrough &&
    left.foreground === right.foreground &&
    left.background === right.background
  )
}

function xtermColor(index: number): AnsiNamedColor | string | null {
  if (!Number.isInteger(index) || index < 0 || index > 255) return null
  if (index < 8) return NORMAL_COLORS[index] ?? null
  if (index < 16) return BRIGHT_COLORS[index - 8] ?? null

  if (index < 232) {
    const cubeIndex = index - 16
    const levels = [0, 95, 135, 175, 215, 255]
    const red = levels[Math.floor(cubeIndex / 36)] ?? 0
    const green = levels[Math.floor((cubeIndex % 36) / 6)] ?? 0
    const blue = levels[cubeIndex % 6] ?? 0
    return `rgb(${red} ${green} ${blue})`
  }

  const gray = 8 + (index - 232) * 10
  return `rgb(${gray} ${gray} ${gray})`
}

function rgbColor(red: number, green: number, blue: number): string | null {
  if (![red, green, blue].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
    return null
  }
  return `rgb(${red} ${green} ${blue})`
}

function applySgr(style: AnsiStyle, rawParameters: string): void {
  const parameters =
    rawParameters === ''
      ? [0]
      : rawParameters.split(';').map(value => (value === '' ? 0 : Number(value)))

  for (let index = 0; index < parameters.length; index += 1) {
    const code = parameters[index]
    if (code === undefined || !Number.isFinite(code)) continue

    if (code === 0) {
      Object.assign(style, defaultStyle())
    } else if (code === 1) {
      style.bold = true
    } else if (code === 2) {
      style.dim = true
    } else if (code === 3) {
      style.italic = true
    } else if (code === 4) {
      style.underline = true
    } else if (code === 7) {
      style.inverse = true
    } else if (code === 9) {
      style.strikethrough = true
    } else if (code === 22) {
      style.bold = false
      style.dim = false
    } else if (code === 23) {
      style.italic = false
    } else if (code === 24) {
      style.underline = false
    } else if (code === 27) {
      style.inverse = false
    } else if (code === 29) {
      style.strikethrough = false
    } else if (code >= 30 && code <= 37) {
      style.foreground = NORMAL_COLORS[code - 30] ?? null
    } else if (code === 39) {
      style.foreground = null
    } else if (code >= 40 && code <= 47) {
      style.background = NORMAL_COLORS[code - 40] ?? null
    } else if (code === 49) {
      style.background = null
    } else if (code >= 90 && code <= 97) {
      style.foreground = BRIGHT_COLORS[code - 90] ?? null
    } else if (code >= 100 && code <= 107) {
      style.background = BRIGHT_COLORS[code - 100] ?? null
    } else if (code === 38 || code === 48) {
      const target = code === 38 ? 'foreground' : 'background'
      const mode = parameters[index + 1]

      if (mode === 5) {
        const color = xtermColor(parameters[index + 2] ?? Number.NaN)
        if (color) style[target] = color
        index += 2
      } else if (mode === 2) {
        const color = rgbColor(
          parameters[index + 2] ?? Number.NaN,
          parameters[index + 3] ?? Number.NaN,
          parameters[index + 4] ?? Number.NaN,
        )
        if (color) style[target] = color
        index += 4
      }
    }
  }
}

function withoutIncompleteEscape(text: string): string {
  const oscStart = text.lastIndexOf('\u001B]')
  const withoutOsc = oscStart === -1 ? text : text.slice(0, oscStart)
  const csiStart = withoutOsc.lastIndexOf('\u001B[')
  if (csiStart === -1) return withoutOsc

  const suffix = withoutOsc.slice(csiStart + 2)
  const isIncomplete = [...suffix].every(character => {
    const codePoint = character.codePointAt(0) ?? -1
    return (codePoint >= 0x30 && codePoint <= 0x3f) || (codePoint >= 0x20 && codePoint <= 0x2f)
  })
  return isIncomplete ? withoutOsc.slice(0, csiStart) : withoutOsc
}

function cleanText(text: string): string {
  return [...withoutIncompleteEscape(text)]
    .filter(character => {
      const codePoint = character.codePointAt(0) ?? -1
      return (
        codePoint === 0x09 ||
        codePoint === 0x0a ||
        codePoint === 0x0d ||
        (codePoint >= 0x20 && codePoint <= 0x7e) ||
        codePoint > 0x9f
      )
    })
    .join('')
}

export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  const style = defaultStyle()
  let cursor = 0

  const pushText = (rawText: string): void => {
    const text = cleanText(rawText)
    if (!text) return

    const snapshot = { ...style }
    const previous = segments.at(-1)
    if (previous && sameStyle(previous.style, snapshot)) {
      previous.text += text
      return
    }
    segments.push({ text, style: snapshot })
  }

  ANSI_SEQUENCE.lastIndex = 0
  for (const match of input.matchAll(ANSI_SEQUENCE)) {
    const matchIndex = match.index
    pushText(input.slice(cursor, matchIndex))

    const parameterBytes = match[1]
    const intermediateBytes = match[2]
    const finalByte = match[3]
    if (finalByte === 'm' && intermediateBytes === '' && parameterBytes !== undefined) {
      applySgr(style, parameterBytes)
    }

    cursor = matchIndex + match[0].length
  }
  pushText(input.slice(cursor))

  return segments
}

export function ansiToPlainText(input: string): string {
  return parseAnsi(input)
    .map(segment => segment.text)
    .join('')
}
