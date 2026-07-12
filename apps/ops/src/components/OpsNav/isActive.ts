/**
 * Whether a nav item's `href` should be treated as the active route for the
 * current pathname.
 *
 * `/ops` is the overview route and would otherwise prefix-match every other
 * `/ops/*` route, so it requires an exact match. Every other href matches
 * itself or a nested path segment (e.g. `/ops/sources` also activates for
 * `/ops/sources/123`).
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/ops') {
    return pathname === '/ops'
  }
  return pathname === href || pathname.startsWith(`${href}/`)
}
