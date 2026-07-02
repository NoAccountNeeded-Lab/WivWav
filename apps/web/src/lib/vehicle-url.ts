export function vehicleDetailPath(id: string, pathPrefix = ''): string {
  const normalizedPrefix = pathPrefix === '/' ? '' : pathPrefix.replace(/\/+$/, '')
  return `${normalizedPrefix}/vehicle/${encodeURIComponent(id)}`
}
