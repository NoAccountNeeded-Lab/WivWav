import { Meilisearch } from 'meilisearch'

let client: Meilisearch | undefined

// #969: read the same MEILISEARCH_HOST/MEILISEARCH_API_KEY env vars
// config.ts and index.ts's own Meilisearch client already use in apps/api.
export function getMeiliClient(): Meilisearch {
  if (!client) {
    const apiKey = process.env['MEILISEARCH_API_KEY']
    client = new Meilisearch({
      host: process.env['MEILISEARCH_HOST'] ?? 'http://localhost:7700',
      ...(apiKey ? { apiKey } : {}),
    })
  }
  return client
}
