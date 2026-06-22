import { describe, expect, it } from 'vitest'
import { getMessagesForLocale } from './messages'

describe('getMessagesForLocale', () => {
  it('loads Spanish messages explicitly', () => {
    const messages = getMessagesForLocale('es')

    expect(messages).toMatchObject({
      SiteHeader: {
        languageSwitcherLabel: 'Idioma',
      },
      IntakeForm: {
        heading: 'Encuentre el vehículo accesible adecuado',
      },
    })
  })

  it('loads ZZ pseudo-locale messages explicitly', () => {
    const messages = getMessagesForLocale('zz')

    expect(messages).toMatchObject({
      Common: {
        skipToMainContent: '**** ** **** *******',
      },
      SiteHeader: {
        languageSwitcherLabel: '********',
      },
    })
  })

  it('falls back to English for unknown locales', () => {
    const messages = getMessagesForLocale('fr')

    expect(messages).toMatchObject({
      SiteHeader: {
        languageSwitcherLabel: 'Language',
      },
    })
  })
})
