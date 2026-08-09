/** Reads a string-typed field off an otherwise-untyped job payload, or undefined. */
export function getStringField(data: unknown, key: string): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}
