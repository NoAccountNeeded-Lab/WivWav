import type { CategoricalRendererType } from './types'

/** Discover renderer per facet group id; unlisted groups use bars. */
export const FILTER_RENDERERS: Partial<Record<string, CategoricalRendererType>> = {
  condition: 'donut',
  seller: 'donut',
  color: 'swatches',
}
