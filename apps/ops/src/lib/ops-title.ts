/**
 * Builds a route's document `<title>` (E8/#735): every `/ops` route gets a
 * distinct, readable title so back/forward history and browser tabs show
 * which page an operator is on, instead of every entry reading the same
 * root `WivWav Ops`.
 */
export function opsPageTitle(section: string): string {
  return `${section} · WivWav Ops`
}
