/**
 * pHash integer codec — conversion between the 16-char hex dHash string
 * (`ListingImage.pHash`) and its signed-int64 view (`ListingImage.pHashInt`).
 *
 * Storage rationale: Postgres `bigint` is a signed 64-bit integer, while a
 * dHash is an unsigned 64-bit value. Hashes with the high bit set therefore
 * store negative. This is a pure two's-complement reinterpretation of the
 * same 64 bits, so XOR (`#`) + `bit_count(x::bit(64))` Hamming predicates
 * are unaffected by the signedness.
 *
 * Single source of truth: both the migration backfill
 * (`20261008030000_add_listing_image_phash_int`) and `upsertListingImage`'s
 * dual-write derive `pHashInt` through `pHashHexToInt` semantics. Callers must
 * never compute the integer view by hand — pass the hex string and let the
 * write path derive it.
 */

const PHASH_HEX_PATTERN = /^[0-9a-fA-F]{16}$/

/** 2^63 — the sign boundary for signed int64. */
const SIGN_BIT = BigInt(2) ** BigInt(63)

/** 2^64 — the modulus for unsigned/signed reinterpretation. */
const MODULUS = BigInt(2) ** BigInt(64)

/**
 * Convert a 16-char hex dHash to the signed int64 stored in `pHashInt`.
 *
 * Throws when `hex` is not a 16-char hex string — fail the write rather than
 * persist a `pHash`/`pHashInt` pair that disagrees.
 */
export function pHashHexToInt(hex: string): bigint {
  if (!PHASH_HEX_PATTERN.test(hex)) {
    throw new Error(`pHash must be a 16-char hex string; got ${JSON.stringify(hex)}`)
  }
  const unsigned = BigInt(`0x${hex}`)
  return unsigned >= SIGN_BIT ? unsigned - MODULUS : unsigned
}

/**
 * Convert a stored `pHashInt` back to the canonical 16-char lowercase hex.
 *
 * Throws when `value` is outside the signed int64 range.
 */
export function pHashIntToHex(value: bigint): string {
  if (value < -SIGN_BIT || value > SIGN_BIT - BigInt(1)) {
    throw new Error(`pHashInt out of signed int64 range; got ${value.toString()}`)
  }
  const unsigned = value < BigInt(0) ? value + MODULUS : value
  return unsigned.toString(16).padStart(16, '0')
}
