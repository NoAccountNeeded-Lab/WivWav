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
    expect(sanitize({ author: 'a', key: 'health', status: 'ok' })).toEqual({ author: 'a', key: 'health', status: 'ok' })
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
    ['{"msg":"password=hunter2hunter2","x":1}', 'hunter2hunter2'],
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

describe('review regressions (#776 codex)', () => {
  it('2: consumes whole quoted values, cookie lists and over-long values (fail closed)', () => {
    expect(sanitizeString('password="one two three" next')).not.toMatch(/two|three/)
    expect(sanitizeString("secret='a b c' x")).not.toMatch(/ b | c/)
    expect(sanitizeString('Cookie: a=x; b=yyyy; c=zzzz')).not.toMatch(/yyyy|zzzz/)
    expect(sanitizeString('Set-Cookie: sid=abc; Path=/; HttpOnly')).not.toContain('abc')
    expect(sanitizeString('token=' + 'A'.repeat(2100) + 'TAILLEAK')).not.toContain('TAILLEAK')
    expect(sanitizeString('password="unclosed secret tail')).not.toContain('tail')
    expect(sanitizeString('https://' + 'u'.repeat(400) + ':pw@host/x')).not.toMatch(/uuuu|pw@/)
    expect(sanitizeString('Authorization: Basic dXNlcjpwYXNz extra')).not.toContain('dXNlcjpwYXNz')
    expect(sanitizeString('Bearer ' + 'a'.repeat(3000) + 'END')).not.toContain('END')
    expect(sanitizeString('eyJhbGciOiJI.' + 'b'.repeat(3000) + '.sigTAIL')).not.toContain('sigTAIL')
  })

  it('3: percent-encoded parameter names are decoded before classification', () => {
    expect(sanitizeString('/x?%74oken=LEAK1&ok=1')).not.toContain('LEAK1')
    expect(sanitizeString('/x?%2574oken=LEAK2')).not.toContain('LEAK2')
    expect(sanitizeString('a=1&api%5Fkey=LEAK3')).not.toContain('LEAK3')
    expect(sanitizeString('/x?page=2&sort=asc')).toBe('/x?page=2&sort=asc')
  })

  it('4: passphrase, client ip, email keys and labelled/intl phones', () => {
    const out = JSON.stringify(
      sanitize({
        passphrase: 'p', clientIp: '1.2.3.4', remoteAddress: '5.6.7.8', ip: '9.9.9.9',
        'bob@example.com': 'x', extra: { note: 'phone=+15551234567 or +44 20 7946 0958' }, ok: 1,
      }),
    )
    for (const s of ['1.2.3.4', '5.6.7.8', '9.9.9.9', 'bob@example.com', '15551234567', '7946 0958', '"p"']) {
      expect(out).not.toContain(s)
    }
    expect(out).toContain('"ok":1')
  })

  it('5: primitives and total characters count toward the budget', () => {
    const many = sanitize(Array.from({ length: 100_000 }, () => 'x'.repeat(100)))
    expect(many.length).toBeLessThan(20_001)
    expect(json(many).length).toBeLessThan(2_500_000)
    const big = sanitize(Array.from({ length: 100 }, () => 'y'.repeat(60_000)))
    expect(json(big).length).toBeLessThan(1_300_000)
    expect(json(big)).toContain('[TRUNCATED]')
    expect(sanitize(Array.from({ length: 100_000 }, () => 1)).length).toBeLessThan(20_001)
  })

  it('6: bare "key" fields survive; compound secret keys do not', () => {
    expect(sanitize({ key: 'health', apiKey: 'a', secretKey: 'b', accessKey: 'c' })).toEqual({ key: 'health' })
  })

  it('7: throwing array-element and Error getters are contained', () => {
    const arr = [1, 2, 3]
    Object.defineProperty(arr, 1, { get() { throw new Error('boom') }, enumerable: true })
    expect(sanitize(arr)).toEqual([1, '[UNREADABLE]', 3])
    const err = new Error('x')
    Object.defineProperty(err, 'message', { get() { throw new Error('boom') } })
    expect(() => sanitize({ err })).not.toThrow()
    expect((sanitize({ err }) as { err: { message: string } }).err.message).toBe('[UNREADABLE]')
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(sanitize({ p: proxy })).toEqual({ p: '[UNREADABLE]' })
  })

  it('8: JSON embedded in strings is sanitized structurally', () => {
    const whole = sanitize({ m: JSON.stringify({ headers: { a: 'LEAKH' }, nested: [{ note: 'mail a@b.com' }], ok: 1 }) })
    expect(whole.m).not.toMatch(/LEAKH|a@b\.com/)
    expect(JSON.parse(whole.m)).toEqual({ nested: [{ note: 'mail [EMAIL]' }], ok: 1 })
    const mid = sanitizeString('request failed: {"cookie":"sid=LEAKC","x":1} (retrying)')
    expect(mid).not.toContain('LEAKC')
    expect(mid).toContain('retrying')
  })

  it('stays linear on new pathological shapes', () => {
    for (const s of ['"'.repeat(60_000), "token='".repeat(9_000), '{'.repeat(60_000), '['.repeat(60_000),
      'a@'.repeat(30_000), '+1 '.repeat(20_000), '%'.repeat(60_000), '?;'.repeat(30_000), 'a://'.repeat(15_000),
      'Cookie:'.repeat(9_000), 'password="'.repeat(6_000)]) {
      const t = Date.now()
      sanitizeString(s)
      expect(Date.now() - t).toBeLessThan(1500)
    }
  })
})

describe('review regressions round 2 (#776 codex)', () => {
  it('1: escape-aware quoted values; unterminated redacts to the end', () => {
    expect(sanitizeString('password="one\\" SECRETTAIL" next=1')).not.toContain('SECRETTAIL')
    expect(sanitizeString("secret='it\\'s TAIL2' ok")).not.toContain('TAIL2')
    expect(sanitizeString('password="never closed \\" TAIL3')).not.toContain('TAIL3')
  })

  it('2: encoded names classified regardless of value quoting; malformed escapes fail closed', () => {
    expect(sanitizeString('%74oken="LEAK1 two"')).not.toMatch(/LEAK1|two/)
    expect(sanitizeString('%74oken%=LEAK2')).not.toContain('LEAK2')
    expect(sanitizeString('?%74oken=\'LEAK3 x\'&a=1')).not.toContain('LEAK3')
  })

  it('3: embedded JSON fragments, multiple and with trailing brackets', () => {
    expect(sanitizeString('[INFO] response {"headers":{"x":"LEAK1"}}')).not.toContain('LEAK1')
    const multi = sanitizeString('a {"cookie":"LEAK2"} b {"authorization":"LEAK3"} c [retry]')
    expect(multi).not.toMatch(/LEAK2|LEAK3/)
    expect(multi).toContain('[retry]')
    expect(sanitizeString('x {"a":{"b":[{"token":"LEAK4"}]}} [retry]')).not.toContain('LEAK4')
    expect(sanitizeString('{"data":"\\"password\\":\\"LEAK5\\""}')).not.toContain('LEAK5')
  })

  it('4: sensitive label before a structured value redacts the whole balanced value', () => {
    for (const t of ['config={"region":"X1"} after', 'headers={"X-Custom":"Y1"}', 'payload: [{"a":"Z1"},{"b":"Z2"}] t', 'config={"unterminated":"X2"']) {
      expect(sanitizeString(t)).not.toMatch(/X1|Y1|Z1|Z2|X2/)
    }
    expect(sanitizeString('config={"a":"}"} tail')).toBe('config=[REDACTED] tail')
  })

  it('5: sentinels and key characters count toward the budget; keys are length-capped', () => {
    const arr = Array.from({ length: 100_000 }, () => 0)
    for (let i = 0; i < arr.length; i += 1) Object.defineProperty(arr, i, { get() { throw new Error('x') }, enumerable: true })
    expect(json(sanitize(arr)).length).toBeLessThan(400_000)
    const keys: Record<string, number> = {}
    for (let i = 0; i < 30_000; i += 1) keys['k' + i + 'x'.repeat(200)] = 1
    expect(json(sanitize(keys)).length).toBeLessThan(8_000_000)
    expect(sanitize({ ['k'.repeat(300)]: 1 })).toEqual({})
  })

  it('5: getters of denied keys are never evaluated', () => {
    let called = false
    const o = { get password(): string { called = true; return 'x' }, ok: 1 }
    expect(sanitize(o)).toEqual({ ok: 1 })
    expect(called).toBe(false)
  })

  it('6: object keys and string assignments share one classifier', () => {
    for (const k of ['pass', 'dsn', 'pw', 'sig', 'auth', 'passphrase', 'jwt']) {
      expect(sanitize({ [k]: 'LEAKV' })).toEqual({})
      expect(sanitizeString(`${k}: LEAKV`)).not.toContain('LEAKV')
      expect(sanitizeString(`x ${k}=LEAKV&y=1`)).not.toContain('LEAKV')
    }
    expect(sanitizeString('status: healthy key: health')).toBe('status: healthy key: health')
  })
})

describe('review regressions round 3 (#776 codex)', () => {
  it('1: whitespace/newlines around separators and JSON-parsed fragments', () => {
    expect(sanitizeString('[INFO] {"token":\n"LEAK1"}')).not.toContain('LEAK1')
    expect(sanitizeString('token \n = \n LEAK2 ok')).not.toContain('LEAK2')
    expect(sanitizeString('x {"a\\u0074oken":"LEAK3","n":1} y')).not.toContain('LEAK3')
    expect(sanitizeString('x {"n":1, "m":"bob@example.com"} [retry]')).toBe('x {"n":1,"m":"[EMAIL]"} [retry]')
    const t = Date.now()
    sanitizeString('{'.repeat(60_000))
    sanitizeString('{[]'.repeat(20_000))
    expect(Date.now() - t).toBeLessThan(1500)
  })

  it('2: single-quoted strings do not end a balanced value early', () => {
    expect(sanitizeString("config={ a: '}', b: 'LEAK1' } t")).not.toContain('LEAK1')
    expect(sanitizeString("config={ a: 'it\\'s }', b: 'LEAK2' } t")).not.toContain('LEAK2')
  })

  it('3: object keys are percent-decoded before classification', () => {
    expect(sanitize({ '%74oken': 'LEAK', 'api%5Fkey': 'LEAK', 'bad%': 'LEAK', ok: 1 })).toEqual({ ok: 1 })
  })

  it('4: escapes remaining after the decode limit fail closed', () => {
    expect(sanitizeString('?%25252574oken=LEAK')).not.toContain('LEAK')
    expect(sanitize({ '%25252574oken': 'LEAK' })).toEqual({})
  })
})

