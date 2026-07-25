/**
 * Position of `priceCents` along the p10–p90 comparable-listing price band,
 * expressed as a 0–100 percentage for a horizontal position indicator.
 * Clamped to [0, 100] so a price outside the band still renders at an edge
 * rather than off the visible track. Returns null when there isn't enough
 * data to place a marker (no price, or a degenerate zero-width band).
 */
export function pricePositionPercent(
  priceCents: number | null,
  band: { p10: number; p90: number },
): number | null {
  if (priceCents === null) return null
  const width = band.p90 - band.p10
  if (width <= 0) return null

  const raw = ((priceCents - band.p10) / width) * 100
  return Math.min(100, Math.max(0, raw))
}
