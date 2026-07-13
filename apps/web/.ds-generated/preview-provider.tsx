'use client'

import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import {
  PathnameContext,
  PathParamsContext,
  SearchParamsContext,
} from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import messages from '../messages/en.json'

export { SearchParamsContext }

const mockRouter = {
  back() {},
  forward() {},
  refresh() {},
  push() {},
  replace() {},
  prefetch() {},
}

export function PreviewProvider({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <AppRouterContext.Provider value={mockRouter}>
        <PathnameContext.Provider value="/discover">
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <PathParamsContext.Provider value={{}}>
              {children}
            </PathParamsContext.Provider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    </NextIntlClientProvider>
  )
}
