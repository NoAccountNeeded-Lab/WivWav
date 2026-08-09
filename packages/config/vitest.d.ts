export interface WivwavAliasEntry {
  find: string | RegExp
  replacement: string
}

export function wivwavSourceAliases(
  workspaceRoot: string,
  names: readonly string[],
  extra?: readonly WivwavAliasEntry[],
): WivwavAliasEntry[]
