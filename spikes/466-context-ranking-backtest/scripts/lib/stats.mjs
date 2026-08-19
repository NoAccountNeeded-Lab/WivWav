// stats.mjs — small deterministic stats helpers (mean, and a seeded
// bootstrap 95% CI for a paired difference).

export function mean(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function mulberry32(seed) {
  let a = seed
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Bootstrap 95% CI for mean(a[i] - b[i]) over paired per-PR samples, using a
 * fixed seed so repeated runs are byte-identical (deterministic accounting
 * is part of the harness's contract, not just the ranking output).
 */
export function bootstrapPairedDiffCI(aValues, bValues, { iterations = 10000, seed = 466 } = {}) {
  if (aValues.length !== bValues.length || aValues.length === 0) {
    return { lower: 0, upper: 0, mean: 0, iterations: 0 }
  }
  const n = aValues.length
  const diffs = aValues.map((a, i) => a - bValues[i])
  const rng = mulberry32(seed)
  const resampleMeans = []
  for (let iter = 0; iter < iterations; iter += 1) {
    let sum = 0
    for (let i = 0; i < n; i += 1) {
      const idx = Math.floor(rng() * n)
      sum += diffs[idx]
    }
    resampleMeans.push(sum / n)
  }
  resampleMeans.sort((a, b) => a - b)
  const lowerIdx = Math.floor(0.025 * iterations)
  const upperIdx = Math.min(iterations - 1, Math.ceil(0.975 * iterations) - 1)
  return {
    lower: resampleMeans[lowerIdx],
    upper: resampleMeans[upperIdx],
    mean: mean(diffs),
    iterations,
  }
}
