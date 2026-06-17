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
  newPage(): Promise<BrowserPage>
  close(): Promise<void>
}

export interface BrowserService {
  launch(): Promise<BrowserSession>
}
