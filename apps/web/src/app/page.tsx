// The middleware redirects all root requests to the appropriate locale prefix.
// This file should never be reached in normal operation, but provides a
// fallback redirect as a safety net.
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/en')
}
