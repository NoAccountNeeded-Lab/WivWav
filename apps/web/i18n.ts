import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import { getMessagesForLocale } from './messages'

export default getRequestConfig(async ({ requestLocale }) => {
  // Validate that the incoming locale is supported; fall back to default.
  let locale = await requestLocale
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale
  }

  return {
    locale,
    messages: getMessagesForLocale(locale),
  }
})
