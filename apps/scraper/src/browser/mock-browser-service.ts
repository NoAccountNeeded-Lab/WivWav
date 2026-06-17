/**
 * MockBrowserService — in-memory BrowserService for unit tests.
 *
 * Create an instance with a map of URL → HTML or a default HTML string,
 * inject it wherever a BrowserService is expected, and assert on the
 * recorded interactions without launching a real browser.
 */
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse, WaitUntilState } from './types.js'

export interface MockPageRecord {
  url: string
  html: string
  statusCode: number
}

type GotoCall = { url: string; options?: { waitUntil?: WaitUntilState; timeout?: number } }
type SetContentCall = { html: string; options?: { waitUntil?: WaitUntilState } }
type WaitForSelectorCall = { selector: string; options?: { timeout?: number } }

export class MockBrowserPage implements BrowserPage {
  private _html: string = ''
  private _url: string = ''
  private _statusCode: number = 200
  public closed = false

  readonly calls = {
    goto: [] as GotoCall[],
    setContent: [] as SetContentCall[],
    content: [] as number[],
    evaluate: [] as number[],
    waitForSelector: [] as WaitForSelectorCall[],
  }

  constructor(private readonly pages: Map<string, MockPageRecord>, private readonly defaultHtml: string) {}

  async goto(
    url: string,
    options?: { waitUntil?: WaitUntilState; timeout?: number },
  ): Promise<BrowserResponse | null> {
    const call: GotoCall = options !== undefined ? { url, options } : { url }
    this.calls.goto.push(call)
    const record = this.pages.get(url)
    this._html = record?.html ?? this.defaultHtml
    this._url = url
    this._statusCode = record?.statusCode ?? 200
    const code = this._statusCode
    return { status: () => code }
  }

  async setContent(html: string, options?: { waitUntil?: WaitUntilState }): Promise<void> {
    const call: SetContentCall = options !== undefined ? { html, options } : { html }
    this.calls.setContent.push(call)
    this._html = html
  }

  async content(): Promise<string> {
    this.calls.content.push(1)
    return this._html
  }

  url(): string {
    return this._url
  }

  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
  async evaluate<T, A>(fn: ((arg: A) => T) | (() => T), arg?: A): Promise<T> {
    this.calls.evaluate.push(1)
    if (arg !== undefined) {
      return (fn as (arg: A) => T)(arg)
    }
    return (fn as () => T)()
  }

  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    const call: WaitForSelectorCall = options !== undefined ? { selector, options } : { selector }
    this.calls.waitForSelector.push(call)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

export class MockBrowserSession implements BrowserSession {
  public closed = false
  public readonly pages: MockBrowserPage[] = []

  constructor(
    private readonly pageMap: Map<string, MockPageRecord>,
    private readonly defaultHtml: string,
  ) {}

  async newPage(): Promise<BrowserPage> {
    const page = new MockBrowserPage(this.pageMap, this.defaultHtml)
    this.pages.push(page)
    return page
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

export class MockBrowserService implements BrowserService {
  public readonly sessions: MockBrowserSession[] = []
  private readonly pageMap: Map<string, MockPageRecord>
  private readonly defaultHtml: string

  constructor(
    /** Map of URL → { html, statusCode } */
    pages: Map<string, MockPageRecord> = new Map(),
    /** HTML returned for any URL not in the map */
    defaultHtml = '<html><body></body></html>',
  ) {
    this.pageMap = pages
    this.defaultHtml = defaultHtml
  }

  async launch(): Promise<BrowserSession> {
    const session = new MockBrowserSession(this.pageMap, this.defaultHtml)
    this.sessions.push(session)
    return session
  }
}
