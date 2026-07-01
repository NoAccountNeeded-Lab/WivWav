/**
 * image-hasher — bounded image download with exact (SHA-256) and perceptual
 * (dHash) hash computation.
 *
 * Download constraints (all configurable):
 *   - Explicit timeout (default 10 s)
 *   - Maximum response body size (default 10 MiB) — enforced via streaming
 *   - Content-type must be an image/* MIME type
 *   - Retry on 5xx / network failure (via fetchWithRetry)
 *   - Rate limiting: callers are responsible for concurrency; this module has
 *     no internal queue.
 *
 * Hashes:
 *   - `exactHash`  = hex SHA-256 of the response body (byte-identical detection)
 *   - `pHash`      = 64-bit difference-hash (dHash) as a 16-char hex string
 *                    (perceptual similarity; two images are "near-duplicates"
 *                    when their Hamming distance is ≤ PHASH_NEAR_DUPLICATE_THRESHOLD)
 *
 * dHash algorithm:
 *   1. Resize image to 9×8 greyscale pixels.
 *   2. For each row, compare each pixel to its right neighbour: bit=1 if left > right.
 *   3. Pack the resulting 64 bits into a 16-char hex string (big-endian).
 *
 * Privacy / licensing:
 *   Raw pixel data and response bytes are held in memory only for the duration
 *   of the hash computation and are never persisted. Only the two hash strings
 *   (≤ 96 chars total) are retained.
 */

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { fetchWithRetry } from '../util/fetch-with-retry.js'

export const PHASH_NEAR_DUPLICATE_THRESHOLD = 10 // Hamming distance ≤ 10 → near-duplicate

/** Maximum response body size to download (10 MiB). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** Default download timeout in milliseconds. */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000

export interface ImageHashResult {
  exactHash: string
  pHash: string
  /** Actual Content-Type reported by the server (after following redirects). */
  contentType: string
  /** Response body size in bytes. */
  byteSize: number
}

export type ImageHashError =
  | { kind: 'timeout' }
  | { kind: 'too_large'; byteSize: number }
  | { kind: 'bad_content_type'; contentType: string }
  | { kind: 'fetch_error'; message: string }
  | { kind: 'decode_error'; message: string }

export type ImageHashOutcome =
  | ({ ok: true } & ImageHashResult)
  | ({ ok: false } & ImageHashError)

export interface ImageHasherOptions {
  /** Maximum bytes to download. Defaults to MAX_IMAGE_BYTES. */
  maxBytes?: number
  /** Fetch timeout in milliseconds. Defaults to DEFAULT_FETCH_TIMEOUT_MS. */
  timeoutMs?: number
  /** fetch-with-retry retries. Defaults to 2. */
  retries?: number
}

/**
 * Download an image from `url`, enforce size/content-type constraints, then
 * compute and return its exact and perceptual hashes.
 *
 * Never throws — all errors are encoded in the returned discriminated union.
 */
export async function hashImage(
  url: string,
  options: ImageHasherOptions = {},
): Promise<ImageHashOutcome> {
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  const retries = options.retries ?? 2

  // ── Fetch ───────────────────────────────────────────────────────────────

  let res: Response
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      res = await fetchWithRetry(
        url,
        { signal: controller.signal },
        { retries, minTimeout: 500, maxTimeout: 5_000 },
      )
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('abort') || msg.toLowerCase().includes('timeout')) {
      return { ok: false, kind: 'timeout' }
    }
    return { ok: false, kind: 'fetch_error', message: msg }
  }

  // ── Content-type check ───────────────────────────────────────────────────

  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.startsWith('image/')) {
    return { ok: false, kind: 'bad_content_type', contentType }
  }

  // ── Bounded body read ────────────────────────────────────────────────────

  if (!res.body) {
    return { ok: false, kind: 'fetch_error', message: 'response body is null' }
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        return { ok: false, kind: 'too_large', byteSize: totalBytes }
      }
      chunks.push(value)
    }
  } catch (err) {
    return {
      ok: false,
      kind: 'fetch_error',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  const bodyBuffer = Buffer.concat(chunks)

  // ── Exact hash (SHA-256) ─────────────────────────────────────────────────

  const exactHash = createHash('sha256').update(bodyBuffer).digest('hex')

  // ── Perceptual hash (dHash, 9×8 → 64-bit) ───────────────────────────────

  let pHash: string
  try {
    pHash = await computeDHash(bodyBuffer)
  } catch (err) {
    return {
      ok: false,
      kind: 'decode_error',
      message: err instanceof Error ? err.message : String(err),
    }
  }

  return {
    ok: true,
    exactHash,
    pHash,
    contentType,
    byteSize: totalBytes,
  }
}

/**
 * Compute a 64-bit difference hash (dHash) from image bytes.
 *
 * Algorithm:
 *   1. Resize to 9×8 greyscale.
 *   2. For each of the 8 rows, compare each of the 8 pixel pairs (left, right).
 *      Bit = 1 if left pixel > right pixel.
 *   3. Return the 64 bits as a 16-char lowercase hex string (big-endian).
 *
 * Returns a 16-character hex string.
 */
export async function computeDHash(imageBuffer: Buffer): Promise<string> {
  // Resize to 9×8 greyscale — 9 columns so each row yields 8 comparison bits.
  const raw = await sharp(imageBuffer)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer()

  // raw is a flat Uint8Array: 9 * 8 = 72 bytes, row-major order.
  let bits = BigInt(0)
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = raw[row * 9 + col]!
      const right = raw[row * 9 + col + 1]!
      bits = (bits << BigInt(1)) | (left > right ? BigInt(1) : BigInt(0))
    }
  }

  // Zero-pad to 16 hex characters (64 bits).
  return bits.toString(16).padStart(16, '0')
}

/**
 * Compute the Hamming distance between two 64-bit dHash values (16-char hex strings).
 *
 * Returns the number of differing bits (0 = identical, 64 = completely different).
 * Throws if either input is not a valid 16-char hex string.
 */
export function hammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== 16 || hashB.length !== 16) {
    throw new Error(`dHash values must be 16-char hex strings; got ${hashA.length} and ${hashB.length}`)
  }
  let a = BigInt('0x' + hashA)
  let b = BigInt('0x' + hashB)
  let xor = a ^ b
  let dist = 0
  while (xor > BigInt(0)) {
    dist += Number(xor & BigInt(1))
    xor >>= BigInt(1)
  }
  return dist
}
