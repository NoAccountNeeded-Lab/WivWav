import { beforeEach, describe, expect, it, vi } from 'vitest'

const browserMocks = vi.hoisted(() => {
  const close = vi.fn(async (): Promise<void> => undefined)
  const launch = vi.fn(async () => ({
    close,
    newPage: vi.fn(),
  }))

  return {
    close,
    launch,
    use: vi.fn(),
  }
})

vi.mock('@playwright/test', () => ({
  chromium: {},
}))

vi.mock('playwright-extra', () => ({
  addExtra: () => ({
    launch: browserMocks.launch,
    use: browserMocks.use,
  }),
}))

vi.mock('puppeteer-extra-plugin-stealth', () => ({
  default: () => ({ name: 'stealth' }),
}))

import { PlaywrightBrowserService } from './playwright-browser-service.js'

describe('PlaywrightBrowserService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should enable the Chromium sandbox when launching', async () => {
    const session = await new PlaywrightBrowserService().launch()

    expect(browserMocks.launch).toHaveBeenCalledWith({ chromiumSandbox: true })
    await session.close()
  })
})
