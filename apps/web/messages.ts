import en from './messages/en.json'
import es from './messages/es.json'
import zz from './messages/zz.json'

const messagesByLocale = {
  en,
  es,
  zz,
} as const

export type MessagesLocale = keyof typeof messagesByLocale

export function hasMessagesForLocale(locale: string): locale is MessagesLocale {
  return locale in messagesByLocale
}

export function getMessagesForLocale(locale: string): Record<string, unknown> {
  return hasMessagesForLocale(locale) ? messagesByLocale[locale] : messagesByLocale.en
}
