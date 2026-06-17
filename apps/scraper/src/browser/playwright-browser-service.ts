/**
 * PlaywrightBrowserService — concrete BrowserService implementation backed by
 * Playwright chromium. This is the only file in apps/scraper that imports
 * @playwright/test directly; all other code uses BrowserService/BrowserPage.
 *
 * page.evaluate pitfall: tsx's esbuild wraps named arrow functions with
 * __name(), which is undefined in the Playwright browser sandbox where only
 * the function body is serialized. Always use `function` declarations instead
 * of `const fn = () => {}` inside page.evaluate() callbacks.
 */
import { chromium } from '@playwright/test'
import type { BrowserService, BrowserSession, BrowserPage, BrowserResponse } from './types.js'

export class PlaywrightBrowserService implements BrowserService {
  async launch(): Promise<BrowserSession> {
    const browser = await chromium.launch()

    return {
      newPage: async (): Promise<BrowserPage> => {
        const page = await browser.newPage()

        return {
          goto: async (url, options): Promise<BrowserResponse | null> => {
            const response = await page.goto(url, options)
            if (response === null) return null
            return { status: () => response.status() }
          },

          setContent: async (html, options): Promise<void> => {
            await page.setContent(html, options)
          },

          content: (): Promise<string> => page.content(),

          url: (): string => page.url(),

          evaluate: <T, A>(fn: ((arg: A) => T) | (() => T), arg?: A): Promise<T> => {
            if (arg !== undefined) {
              return (page.evaluate as (fn: (arg: A) => T, arg: A) => Promise<T>)(
                fn as (arg: A) => T,
                arg,
              )
            }
            return (page.evaluate as (fn: () => T) => Promise<T>)(fn as () => T)
          },

          waitForSelector: async (selector, options): Promise<void> => {
            await page.waitForSelector(selector, options)
          },

          close: (): Promise<void> => page.close(),
        }
      },

      close: (): Promise<void> => browser.close(),
    }
  }
}
