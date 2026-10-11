import { describe, expect, it } from 'vitest'
import { MAX_DEPTH, sanitizeDiagnosticResponse as sanitize, sanitizeString } from './diagnostic-sanitizer.js'

const json = (v: unknown) => JSON.stringify(v)

describe('sanitizeDiagnosticResponse keys', () => {
  it('strips sensitive keys at any depth, case/separator-insensitive', () => {
    const out = sanitize({
      ok: 1,
      Headers: { a: 1 },
      a: { b: [{ c: { 'Set-Cookie': 'x', Authorization: 'Bearer abcdefgh12345', api_key: 'k', keep: 'v' } }] },
      encryptedConfig: 'x',
      jobPayload: { vin: 'x' },
      db_password: 'p',
      clientSecret: 's',
      accessToken: 't',
    })
    expect(out).toEqual({ ok: 1, a: { b: [{ c: { keep: 'v' } }] } })
  })

  it('does not over-strip lookalike keys', () => {
    expect(sanitize({ author: 'a', monkey: 1, status: 'ok' })).toEqual({ author: 'a', monkey: 1, status: 'ok' })
  })

  it('handles unexpected key shapes and __proto__', () => {
    const o = JSON.parse('{"__proto__":{"polluted":true},"Unknown-Key":"v","":"e"}') as object
    const out = sanitize(o) as Record<string, unknown>
    expect(out['polluted']).toBeUndefined()
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
    expect(out['Unknown-Key']).toBe('v')
  })
})

describe('sanitizeDiagnosticResponse strings', () => {
  it.each([
    ['https://x.test/cb?token=abc123SECRET&ok=1', 'abc123SECRET'],
    ['GET /a?foo=1&api_key=ZZZsecretZZZ HTTP/1.1', 'ZZZsecretZZZ'],
    ['https://admin:hunter2@db.internal:5432/x', 'hunter2'],
    ['postgres://user:p%40ss@host/db', 'p%40ss'],
    ['Authorization: Bearer abcdefghijklmnop', 'abcdefghijklmnop'],
    ['failed for jane.doe+x@example.co.uk twice', 'jane.doe'],
    ['call 555-123-4567 or +1 (555) 987-6543', '123-4567'],
    ['key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv', 'AbCdEfGh'],
    ['gh ghp_abcdefghijklmnopqrstuvwxyz0123', 'abcdefghijkl'],
    ['aws AKIAABCDEFGHIJKLMNOP', 'AKIAABCDEFGHIJKLMNOP'],
    ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.SflKxwRJSMeKKF2QT4fw', 'SflKxwRJ'],
    ['{"password":"hunter2hunter2","x":1}', 'hunter2hunter2'],
    ['VIN 1HGCM82633A004352 seen', '1HGCM82633A004352'],
  ])('redacts %s', (input, secret) => {
    const out = sanitizeString(input)
    expect(out).not.toContain(secret)
    expect(out).toMatch(/REDACTED|EMAIL|PHONE|VIN/)
  })

  it('keeps benign text and context', () => {
    expect(sanitizeString('queue scrape failed at 2026-10-11T11:33:00Z after 3 retries')).toBe(
      'queue scrape failed at 2026-10-11T11:33:00Z after 3 retries',
    )
    expect(sanitizeString('https://x.test/cb?token=abc&ok=1')).toBe('https://x.test/cb?token=[REDACTED]&ok=1')
  })

  it('redacts stack traces and error messages in nested values', () => {
    const err = new Error('login failed for bob@example.com with api_key=SUPERSECRET123')
    err.stack = `Error: boom\n    at fetch (https://u:pw12345@h.test/x?access_token=TOK123456)\n    at run (/app/x.js:1:1)`
    const out = json(sanitize({ lines: [{ error: err }], log: 'user bob@example.com token=abcd1234efgh' }))
    for (const s of ['bob@example.com', 'SUPERSECRET123', 'pw12345', 'TOK123456', 'abcd1234efgh']) {
      expect(out).not.toContain(s)
    }
    expect(out).toContain('/app/x.js:1:1')
  })
})

describe('sanitizeDiagnosticResponse safety', () => {
  it('does not mutate input', () => {
    const input = { headers: { a: 'b' }, nested: { msg: 'mail a@b.com', list: ['token=abcdefgh'] } }
    const snapshot: unknown = JSON.parse(JSON.stringify(input))
    const out = sanitize(input)
    expect(input).toEqual(snapshot)
    expect(out).not.toBe(input)
    expect(out.nested).not.toBe(input.nested)
    expect(out.nested.list).not.toBe(input.nested.list)
  })

  it('handles cycles', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a['self'] = a
    a['arr'] = [a]
    const out = sanitize(a) as Record<string, unknown>
    expect(out['self']).toBe('[CIRCULAR]')
    expect(out['arr']).toEqual(['[CIRCULAR]'])
  })

  it('handles very deep nesting without throwing', () => {
    let deep: Record<string, unknown> = { leaf: 'x' }
    for (let i = 0; i < 100_000; i += 1) deep = { n: deep }
    const out = json(sanitize(deep))
    expect(out).toContain('[TRUNCATED]')
    expect(out.split('{').length).toBeLessThanOrEqual(MAX_DEPTH + 2)
  })

  it('handles wide inputs within the node budget', () => {
    const out = sanitize(Array.from({ length: 100_000 }, () => ({ a: 1 })))
    expect(out.length).toBeLessThan(100_000)
  })

  it('survives throwing getters and exotic values', () => {
    const o = { get bad(): string { throw new Error('x') }, f: () => 1, n: NaN, b: 5n, u: undefined }
    expect(sanitize(o)).toEqual({ bad: '[UNREADABLE]', n: null, b: '5', u: undefined })
  })

  it.each([
    ['a'.repeat(200_000)],
    ['a@'.repeat(50_000)],
    ['?token='.repeat(20_000)],
    ['token='.repeat(20_000)],
    ['1'.repeat(200_000)],
    ['a.'.repeat(100_000) + '@'],
    ['://'.repeat(50_000)],
    ['Bearer '.repeat(20_000)],
    ['eyJ' + 'a'.repeat(100_000)],
    ['x-'.repeat(100_000) + 'token'],
  ])('is fast on pathological string %#', (s) => {
    const t = Date.now()
    sanitizeString(s)
    expect(Date.now() - t).toBeLessThan(1500)
  })
})
