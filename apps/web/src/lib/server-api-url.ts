import { DEFAULT_PUBLIC_API_URL } from './api-url'

/**
 * Destructure the environment at request time. Next replaces direct
 * NEXT_PUBLIC_* references with build-time values in server bundles too.
 * Keep this module out of client components; browsers use the body attribute.
 */
export function getPublicApiBaseUrl(): string {
  const { NEXT_PUBLIC_API_URL } = process.env
  return NEXT_PUBLIC_API_URL?.trim() || DEFAULT_PUBLIC_API_URL
}

export function getServerApiBaseUrl(): string {
  const { API_INTERNAL_URL } = process.env
  return API_INTERNAL_URL?.trim() || getPublicApiBaseUrl()
}
