// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/test-utils/intl'
import ErrorPage from './error'
import LocaleErrorPage from './[locale]/error'

vi.mock('@/lib/error-reporter', () => ({ reportError: vi.fn() }))

afterEach(() => cleanup())

describe.each([
  ['root error boundary', ErrorPage],
  ['locale error boundary', LocaleErrorPage],
])('%s', (_name, Page) => {
  it('announces the error in English', () => {
    renderWithIntl(<Page error={new Error('boom')} reset={() => {}} />)

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'An error occurred' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' }).getAttribute('aria-describedby')).toBe(
      'error-description',
    )
  })

  it('announces the error in Spanish', () => {
    renderWithIntl(<Page error={new Error('boom')} reset={() => {}} />, 'es')

    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Se produjo un error' })).toBeTruthy()
    expect(screen.getByText('Algo salió mal.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Intentar de nuevo' })).toBeTruthy()
    expect(screen.queryByText('Try again')).toBeNull()
  })
})
