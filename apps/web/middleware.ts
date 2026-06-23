import createMiddleware from 'next-intl/middleware'
import { routing } from './routing'

export default createMiddleware(routing)

export const config = {
  // Match all pathnames except: Next.js internals, API routes, static files, and ops (internal tool, no i18n needed)
  matcher: ['/((?!_next|api|ops|status|.*\\..*).*)'],
}
