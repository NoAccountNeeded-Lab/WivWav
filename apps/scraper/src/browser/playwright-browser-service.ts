/**
 * PlaywrightBrowserService — concrete BrowserService implementation backed by
 * Playwright chromium. This is the only file in apps/scraper that imports
 * @playwright/test directly; all other code uses BrowserService/BrowserPage.
 *
 * Stealth mode: playwright-extra wraps the launcher and loads the stealth
 * plugin, which patches navigator.webdriver, plugin counts, and other
 * well-known headless signals. The BrowserService interface is unchanged.
 *
 * page.evaluate pitfall: tsx's esbuild wraps named arrow functions with
 * __name(), which is undefined in the Playwright browser sandbox where only
 * the function body is serialized. Always use `function` declarations instead
 * of `const fn = () => {}` inside page.evaluate() callbacks.
 */
import { chromium as baseChromium } from '@playwright/test'
import { addExtra } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import type {
  BrowserService,
  BrowserSession,
  BrowserPage,
  BrowserResponse,
  NewPageOptions,
} from './types.js'

// Wrap the base chromium launcher with stealth plugin support.
// addExtra() returns a new PlaywrightExtra instance each call, so we create
// the augmented launcher once at module scope to avoid redundant wrapping.
const chromium = addExtra(baseChromium)
chromium.use(StealthPlugin())

export class PlaywrightBrowserService implements BrowserService {
  async launch(): Promise<BrowserSession> {
    const browser = await chromium.launch()

    return {
      newPage: async (options?: NewPageOptions): Promise<BrowserPage> => {
        const page = await browser.newPage({
          userAgent:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        })

        // Abort byte-heavy subresources before they're requested. Scrapers read
        // asset URLs from HTML attributes, never the bytes, so loading them only
        // accumulates in-flight requests across navigations on this reused page
        // and eventually trips net::ERR_INSUFFICIENT_RESOURCES.
        const blocked = options?.blockResourceTypes
        if (blocked && blocked.length > 0) {
          const blockedSet = new Set<string>(blocked)
          await page.route('**/*', route => {
            if (blockedSet.has(route.request().resourceType())) {
              return route.abort()
            }
            return route.continue()
          })
        }

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
