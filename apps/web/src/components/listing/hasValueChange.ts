/** True when `values` holds at least two distinct numbers (a real change to show). */
export function hasValueChange(values: number[]): boolean {
  return new Set(values).size >= 2
}
