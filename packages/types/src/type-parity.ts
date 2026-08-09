/**
 * Compile-time helpers for asserting that a zod-inferred wire-contract type
 * and a hand-written interface stay in parity (#948/#949). Type-only — this
 * module has no runtime footprint.
 *
 * Usage (in a test file, so `tsc` fails when the shapes drift):
 *
 *   export type _Parity = AssertTrue<MutuallyAssignable<z.infer<typeof s>, T>>
 */

/**
 * Adds `| undefined` to every property, recursively through plain nested
 * objects (arrays, Dates, and primitives pass through unchanged). Under
 * `exactOptionalPropertyTypes`, zod's `.optional()` infers `?: T | undefined`
 * while hand-written types write `?: T` — a difference with no wire-level
 * meaning. Widening both comparison targets neutralizes exactly that;
 * required keys stay load-bearing (a wrongly optional or missing key still
 * fails both directions of MutuallyAssignable).
 */
export type WidenOptional<T> = T extends Date
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: WidenOptional<T[K]> | undefined }
      : T

export type MutuallyAssignable<A, B> = [A] extends [WidenOptional<B>]
  ? [B] extends [WidenOptional<A>]
    ? true
    : false
  : false

export type AssertTrue<T extends true> = T
