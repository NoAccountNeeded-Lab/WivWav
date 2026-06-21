const VIN_PATTERN = /\b[A-HJ-NPR-Z0-9]{17}\b/gi
const IP_FIELD_KEYS = new Set(['ip_address'])
const IP_HEADER_KEYS = new Set(['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded'])
const SENSITIVE_FIELD_KEYS = new Set(['email', 'phone', 'dealer_email', 'dealer_phone', 'contact'])
const MAX_SCRUB_DEPTH = 6

export function scrubPii(value: string): string {
  return value.replace(VIN_PATTERN, '[VIN]')
}

function scrubRecord(record: Record<string, unknown>, depth: number): void {
  for (const key of Object.keys(record)) {
    const normalizedKey = key.toLowerCase()

    if (
      IP_FIELD_KEYS.has(normalizedKey) ||
      IP_HEADER_KEYS.has(normalizedKey) ||
      SENSITIVE_FIELD_KEYS.has(normalizedKey)
    ) {
      delete record[key]
      continue
    }

    record[key] = scrubUnknown(record[key], depth + 1)
  }
}

function scrubUnknown(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubPii(value)
  if (value === null || typeof value !== 'object' || depth >= MAX_SCRUB_DEPTH) return value

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      value[i] = scrubUnknown(value[i], depth + 1)
    }
    return value
  }

  scrubRecord(value as Record<string, unknown>, depth)
  return value
}

export function scrubSentryEvent<T extends object>(event: T): T {
  scrubUnknown(event)
  return event
}
