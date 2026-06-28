/**
 * Browser abstraction layer — callers never import Playwright directly.
 *
 * page.evaluate pitfall: tsx's esbuild wraps named arrow functions with
 * __name(), which is undefined in the Playwright browser sandbox where only
 * the function body is serialized. Always use `function` declarations instead
 * of `const fn = () => {}` inside page.evaluate() callbacks.
 */

/** Subset of Playwright's supported waitUntil values. */
export type WaitUntilState = 'load' | 'domcontentloaded' | 'networkidle' | 'commit'

/**
 * Playwright resource types a page may be told to abort before the request is
 * issued. Scrapers only need the DOM (and asset URLs read from attributes), so
 * blocking these byte-heavy subresources avoids accumulating in-flight requests
 * across many navigations on a reused page — which otherwise exhausts
 * Chromium's network service and fails with net::ERR_INSUFFICIENT_RESOURCES.
 */
export type BlockableResourceType = 'image' | 'media' | 'font' | 'stylesheet'

export interface NewPageOptions {
  /** Resource types to abort instead of loading. */
  blockResourceTypes?: BlockableResourceType[]
}

/** Minimal response object returned by BrowserPage.goto(). */
export interface BrowserResponse {
  status(): number
}

export interface BrowserPage {
  goto(
    url: string,
    options?: { waitUntil?: WaitUntilState; timeout?: number },
  ): Promise<BrowserResponse | null>
  setContent(html: string, options?: { waitUntil?: WaitUntilState }): Promise<void>
  content(): Promise<string>
  url(): string
  evaluate<T>(fn: () => T): Promise<T>
  evaluate<T, A>(fn: (arg: A) => T, arg: A): Promise<T>
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<void>
  close(): Promise<void>
}

export interface BrowserSession {
  newPage(options?: NewPageOptions): Promise<BrowserPage>
  close(): Promise<void>
}

export interface BrowserService {
  launch(): Promise<BrowserSession>
}
