'use client'

import { lazy, Suspense, useState } from 'react'
import type { CategoricalRendererProps, CategoricalRendererType, FilterItem } from './types'
import { FacetModal } from './FacetModal'
import styles from './FilterGroup.module.css'

// ── Renderer registry ─────────────────────────────────────────────────────────
// Lazy-load so unused renderers don't ship in every bundle.

const RENDERERS: Record<CategoricalRendererType, React.LazyExoticComponent<React.ComponentType<CategoricalRendererProps>>> = {
  bars:     lazy(() => import('./BarsRenderer').then((m) => ({ default: m.BarsRenderer }))),
  barsCountLeft: lazy(() => import('./BarsRenderer').then((m) => ({ default: m.BarsCountLeftRenderer }))),
  chips:    lazy(() => import('./ChipsRenderer').then((m) => ({ default: m.ChipsRenderer }))),
  donut:    lazy(() => import('./DonutRenderer').then((m) => ({ default: m.DonutRenderer }))),
  swatches: lazy(() => import('./SwatchesRenderer').then((m) => ({ default: m.SwatchesRenderer }))),
}

// ── FilterGroup ───────────────────────────────────────────────────────────────

interface FilterGroupProps {
  title: string
  labelId: string
  items: FilterItem[]
  onToggle: (value: string) => void
  renderer?: CategoricalRendererType
  /** Max items shown before a "show more" button appears. undefined = show all. */
  maxVisible?: number
}

export function FilterGroup({
  title,
  labelId,
  items,
  onToggle,
  renderer = 'bars',
  maxVisible = 8,
}: FilterGroupProps) {
  const [showAll, setShowAll] = useState(false)

  const Renderer = RENDERERS[renderer]

  const sorted = [...items].sort((a, b) => {
    if (a.disabled !== b.disabled) return a.disabled ? 1 : -1
    return b.count - a.count
  })

  const hasMore = sorted.length > maxVisible
  // Collapsed view always shows the first `maxVisible` items so the base
  // page layout never shifts; the full list only appears in the modal.
  const visible = hasMore ? sorted.slice(0, maxVisible) : sorted
  const maxCount = sorted.find((i) => !i.disabled)?.count ?? 1

  return (
    <div className={styles.group} role="group" aria-labelledby={labelId}>
      {/* `inert` while the modal is open keeps these controls out of both the
          tab order and the accessibility tree, so screen readers can't reach
          this facet's own buttons "behind" the dialog. */}
      <div className={styles.content} inert={showAll}>
        <span id={labelId} className={styles.title}>{title}</span>
        <Suspense fallback={null}>
          <Renderer items={visible} onToggle={onToggle} maxCount={maxCount} />
        </Suspense>
        {hasMore && (
          <button
            type="button"
            className={styles.showMore}
            onClick={() => setShowAll(true)}
            aria-haspopup="dialog"
          >
            {`Show ${sorted.length - maxVisible} more`}
          </button>
        )}
      </div>
      {showAll && (
        <FacetModal title={title} onClose={() => setShowAll(false)}>
          <Suspense fallback={null}>
            <Renderer items={sorted} onToggle={onToggle} maxCount={maxCount} />
          </Suspense>
        </FacetModal>
      )}
    </div>
  )
}
