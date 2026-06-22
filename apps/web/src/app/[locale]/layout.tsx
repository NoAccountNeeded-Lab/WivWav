import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getMessages, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { ConditionalFooter } from '@/components/ConditionalFooter'
import { Footer } from '@/components/Footer'
import { ConditionalSkipLink } from '@/components/ConditionalSkipLink'
import { routing } from '../../../routing'

interface LocaleLayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  setRequestLocale(locale)
  const messages = await getMessages({ locale })
  const commonMessages = messages.Common as { skipToMainContent: string }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ConditionalSkipLink label={commonMessages.skipToMainContent} />
      {children}
      <ConditionalFooter footer={<Footer locale={locale} />} />
    </NextIntlClientProvider>
  )
}
