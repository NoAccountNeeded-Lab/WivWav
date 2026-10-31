import { ErrorBoundary } from '@wivwav/web'

// ErrorBoundary is a logic-only wrapper, but it DOES render a visible
// fallback UI when a child throws during render — that fallback is worth
// showing. Compose it with a child that throws unconditionally.
const labels = {
  heading: 'Something went wrong',
  description: 'We could not load this page. Please try again.',
  reload: 'Reload page',
}

function ThrowingListingCard(): never {
  throw new Error('Failed to load listing details')
}

export function CaughtError() {
  return (
    <ErrorBoundary labels={labels}>
      <ThrowingListingCard />
    </ErrorBoundary>
  )
}

export function CustomFallback() {
  return (
    <ErrorBoundary
      labels={labels}
      fallback={
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p>We couldn&apos;t load this vehicle&apos;s listing. Please try again.</p>
        </div>
      }
    >
      <ThrowingListingCard />
    </ErrorBoundary>
  )
}
