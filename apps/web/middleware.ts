import createMiddleware from 'next-intl/middleware'
import { routing } from './routing'

export default createMiddleware(routing)

export const config = {
  // Match all pathnames except: Next.js internals, API routes, and static files
  matcher: ['/((?!_next|api|.*\\..*).*)'],
}
