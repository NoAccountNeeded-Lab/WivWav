'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ImageOff, Maximize2, X } from 'lucide-react'
import styles from './PhotoGallery.module.css'

export interface PhotoCategory {
  id: string
  label: string
}

interface PhotoGalleryProps {
  images: string[]
  alt: string
  className?: string | undefined
  viewportClassName?: string | undefined
  imageClassName?: string | undefined
  dotsClassName?: string | undefined
  placeholderLabel?: string | undefined
  showExpand?: boolean | undefined
  topOverlay?: ReactNode
  bottomOverlay?: ReactNode
  /**
   * Optional AI-derived alt text, parallel to `images` by index. An index
   * that is `null`/`undefined` (or an absent array) falls back to `alt`.
   */
  imageAlts?: (string | null | undefined)[] | undefined
  /**
   * Optional filter category ids per image, parallel to `images` by index.
   * When every entry is empty/absent, no filter chips render and gallery
   * behavior is unchanged from before this prop existed.
   */
  imageCategories?: (string[] | null | undefined)[] | undefined
  /** Category id → display label, used to render filter chip text. */
  categoryLabels?: Record<string, string> | undefined
}

interface SwipePoint {
  x: number
  y: number
}

interface UseSwipeHandlersOptions {
  /** Minimum horizontal delta (px) to trigger left/right navigation. Default 40. */
  horizontalThreshold?: number
  /** Minimum vertical delta (px) to trigger the dismiss callback. Default 80. */
  verticalThreshold?: number
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeDown?: () => void
}

function useSwipeHandlers({
  horizontalThreshold = 40,
  verticalThreshold = 80,
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
}: UseSwipeHandlersOptions) {
  const startPoint = useRef<SwipePoint | null>(null)

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    if (!touch) return
    startPoint.current = { x: touch.clientX, y: touch.clientY }
  }, [])

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!startPoint.current) return

      const touch = event.changedTouches[0]
      if (!touch) return

      const deltaX = touch.clientX - startPoint.current.x
      const deltaY = touch.clientY - startPoint.current.y
      startPoint.current = null

      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      // Horizontal swipe dominates — prevent vertical scroll interference
      if (absX >= horizontalThreshold && absX > absY) {
        if (deltaX < 0 && onSwipeLeft) onSwipeLeft()
        else if (deltaX > 0 && onSwipeRight) onSwipeRight()
        return
      }

      // Downward swipe (dismiss), only when not primarily horizontal
      if (deltaY >= verticalThreshold && absY > absX && onSwipeDown) {
        onSwipeDown()
      }
    },
    [horizontalThreshold, verticalThreshold, onSwipeLeft, onSwipeRight, onSwipeDown],
  )

  return { handleTouchStart, handleTouchEnd }
}

export function PhotoGallery({
  images,
  alt,
  className,
  viewportClassName,
  imageClassName,
  dotsClassName,
  placeholderLabel = 'No photo available',
  showExpand = true,
  topOverlay,
  bottomOverlay,
  imageAlts,
  imageCategories,
  categoryLabels,
}: PhotoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const expandedCloseRef = useRef<HTMLButtonElement | null>(null)

  const categories = useMemo<PhotoCategory[]>(() => {
    if (!imageCategories) return []
    const seen = new Map<string, PhotoCategory>()
    for (const ids of imageCategories) {
      for (const id of ids ?? []) {
        if (seen.has(id)) continue
        seen.set(id, { id, label: categoryLabels?.[id] ?? id })
      }
    }
    return [...seen.values()]
  }, [imageCategories, categoryLabels])
  const hasCategories = categories.length > 0

  // Each entry keeps the original `images` index alongside the source, so
  // filtering never loses track of which `imageAlts`/`imageCategories`
  // entry belongs to which visible slide.
  const entries = useMemo(
    () =>
      images
        .map((src, index) => ({ src, index }))
        .filter(
          ({ index }) =>
            activeCategory === null || (imageCategories?.[index] ?? []).includes(activeCategory),
        ),
    [images, imageCategories, activeCategory],
  )

  const altForOriginalIndex = useCallback(
    (originalIndex: number | undefined) => {
      if (originalIndex === undefined) return alt
      return imageAlts?.[originalIndex] ?? alt
    },
    [alt, imageAlts],
  )

  // Selecting a different filter chip resets to its first matching photo —
  // the previous activeIndex may not exist in the newly filtered set.
  useEffect(() => {
    setActiveIndex(0)
  }, [activeCategory])

  const imageCount = entries.length
  // `activeIndex` state updates asynchronously (the reset-on-filter effect
  // above), but `entries` shrinks synchronously in the same render as a
  // category change. Clamping here guarantees every render reads/writes a
  // valid slide — no one-frame render of an out-of-range index (which would
  // blank the active slide's alt text and misposition the track) while the
  // effect catches up.
  const displayIndex = imageCount === 0 ? 0 : Math.min(activeIndex, imageCount - 1)
  const hasMultipleImages = imageCount > 1
  const hasImages = imageCount > 0
  const visibleDotIndices = getVisibleDotIndices(displayIndex, imageCount)

  const goTo = useCallback(
    (index: number) => {
      if (imageCount === 0) return
      setActiveIndex((index + imageCount) % imageCount)
    },
    [imageCount],
  )

  const goToPrevious = useCallback(() => goTo(displayIndex - 1), [displayIndex, goTo])
  const goToNext = useCallback(() => goTo(displayIndex + 1), [displayIndex, goTo])

  const closeExpanded = useCallback(() => setIsExpanded(false), [])

  useEffect(() => {
    if (!isExpanded) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    expandedCloseRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeExpanded()
      if (event.key === 'ArrowLeft' && hasMultipleImages) goToPrevious()
      if (event.key === 'ArrowRight' && hasMultipleImages) goToNext()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [closeExpanded, goToNext, goToPrevious, hasMultipleImages, isExpanded])

  // Inline gallery swipe — horizontal only, 40 px threshold
  const { handleTouchStart: handleViewportTouchStart, handleTouchEnd: handleViewportTouchEnd } =
    useSwipeHandlers({
      horizontalThreshold: 40,
      ...(hasMultipleImages && { onSwipeLeft: goToNext, onSwipeRight: goToPrevious }),
    })

  // Lightbox swipe — horizontal navigate + downward dismiss, 80 px vertical threshold
  const { handleTouchStart: handleLightboxTouchStart, handleTouchEnd: handleLightboxTouchEnd } =
    useSwipeHandlers({
      horizontalThreshold: 40,
      verticalThreshold: 80,
      ...(hasMultipleImages && { onSwipeLeft: goToNext, onSwipeRight: goToPrevious }),
      onSwipeDown: closeExpanded,
    })

  const handleViewportClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasMultipleImages) return
    if ((event.target as HTMLElement).closest('button')) return

    const bounds = event.currentTarget.getBoundingClientRect()
    const clickX = event.clientX - bounds.left
    if (clickX < bounds.width / 2) goToPrevious()
    else goToNext()
  }

  return (
    <section
      className={[styles.gallery, className].filter(Boolean).join(' ')}
      aria-roledescription="carousel"
      aria-label={`${alt} photos`}
    >
      {hasCategories && (
        <div className={styles.filterChips} role="group" aria-label="Filter photos by category">
          <button
            type="button"
            className={`${styles.filterChip} ${activeCategory === null ? styles.filterChipActive : ''}`}
            aria-pressed={activeCategory === null}
            onClick={() => setActiveCategory(null)}
          >
            All
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`${styles.filterChip} ${activeCategory === category.id ? styles.filterChipActive : ''}`}
              aria-pressed={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.label}
            </button>
          ))}
        </div>
      )}

      {hasCategories && (
        <div className={styles.srOnly} aria-live="polite">
          Showing {imageCount} of {images.length} photos
        </div>
      )}

      {/* Click-to-advance on the viewport is a pointer-only convenience: the
        ArrowLeft/ArrowRight keydown handler above and the dedicated
        previous/next buttons below already give keyboard users full,
        equivalent control over the carousel. */}
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div
        className={[styles.viewport, viewportClassName].filter(Boolean).join(' ')}
        onClick={handleViewportClick}
        onTouchStart={handleViewportTouchStart}
        onTouchEnd={handleViewportTouchEnd}
      >
        {hasImages ? (
          <div className={styles.track} style={{ transform: `translateX(-${displayIndex * 100}%)` }}>
            {entries.map(({ src, index: originalIndex }, index) => (
              <div
                key={`${originalIndex}-${src}`}
                className={styles.slide}
                aria-hidden={index !== displayIndex}
              >
                <img
                  src={src}
                  alt={index === displayIndex ? altForOriginalIndex(originalIndex) : ''}
                  className={[styles.image, imageClassName].filter(Boolean).join(' ')}
                  loading={index === 0 ? 'eager' : 'lazy'}
                  draggable={false}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.placeholder} role="img" aria-label={placeholderLabel}>
            <div className={styles.placeholderInner}>
              <ImageOff size={48} strokeWidth={1.5} aria-hidden />
              <span>{placeholderLabel}</span>
            </div>
          </div>
        )}

        {topOverlay && <div className={styles.overlayTop}>{topOverlay}</div>}
        {bottomOverlay && <div className={styles.overlayBottom}>{bottomOverlay}</div>}

        {hasImages && showExpand && (
          <button
            className={styles.expandButton}
            type="button"
            aria-label="Expand photo gallery"
            onClick={() => setIsExpanded(true)}
          >
            <Maximize2 size={18} aria-hidden />
          </button>
        )}

        {hasMultipleImages && (
          <>
            <button
              className={`${styles.arrow} ${styles.arrowPrev}`}
              type="button"
              aria-label="Previous photo"
              onClick={goToPrevious}
            >
              <ChevronLeft size={22} aria-hidden />
            </button>
            <button
              className={`${styles.arrow} ${styles.arrowNext}`}
              type="button"
              aria-label="Next photo"
              onClick={goToNext}
            >
              <ChevronRight size={22} aria-hidden />
            </button>
          </>
        )}
      </div>

      {hasMultipleImages && (
        <div className={[styles.dots, dotsClassName].filter(Boolean).join(' ')} aria-label="Photo navigation">
          {visibleDotIndices.map((index) => (
            <button
              key={index}
              type="button"
              className={`${styles.dot} ${index === displayIndex ? styles.dotActive : ''}`}
              data-distance={Math.min(Math.abs(index - displayIndex), 3)}
              aria-label={`Photo ${index + 1} of ${imageCount}`}
              aria-current={index === displayIndex ? 'true' : undefined}
              onClick={() => goTo(index)}
            />
          ))}
        </div>
      )}

      {isExpanded && hasImages && (
        <div
          className={styles.lightbox}
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} expanded photos`}
          onTouchStart={handleLightboxTouchStart}
          onTouchEnd={handleLightboxTouchEnd}
        >
          <button
            ref={expandedCloseRef}
            className={`${styles.lightboxButton} ${styles.lightboxClose}`}
            type="button"
            aria-label="Close expanded photo gallery"
            onClick={closeExpanded}
          >
            <X size={24} aria-hidden />
          </button>

          {hasMultipleImages && (
            <button
              className={`${styles.lightboxButton} ${styles.lightboxPrev}`}
              type="button"
              aria-label="Previous photo"
              onClick={goToPrevious}
            >
              <ChevronLeft size={30} aria-hidden />
            </button>
          )}

          <div className={styles.lightboxStage}>
            <img
              src={entries[displayIndex]?.src}
              alt={altForOriginalIndex(entries[displayIndex]?.index)}
              className={styles.lightboxImage}
              draggable={false}
            />
            <div className={styles.lightboxCount}>
              Photo {displayIndex + 1} of {imageCount}
            </div>
          </div>

          {hasMultipleImages && (
            <button
              className={`${styles.lightboxButton} ${styles.lightboxNext}`}
              type="button"
              aria-label="Next photo"
              onClick={goToNext}
            >
              <ChevronRight size={30} aria-hidden />
            </button>
          )}

          {hasMultipleImages && (
            <div className={styles.lightboxDots} aria-label="Expanded photo navigation">
              {entries.map(({ index: originalIndex }, index) => (
                <button
                  key={originalIndex}
                  type="button"
                  className={`${styles.lightboxDot} ${index === displayIndex ? styles.lightboxDotActive : ''}`}
                  aria-label={`Photo ${index + 1} of ${imageCount}`}
                  aria-current={index === displayIndex ? 'true' : undefined}
                  onClick={() => goTo(index)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function getVisibleDotIndices(activeIndex: number, imageCount: number): number[] {
  const maxVisible = 7
  if (imageCount <= maxVisible) return Array.from({ length: imageCount }, (_, index) => index)

  const halfWindow = Math.floor(maxVisible / 2)
  const start = Math.min(Math.max(activeIndex - halfWindow, 0), imageCount - maxVisible)
  return Array.from({ length: maxVisible }, (_, offset) => start + offset)
}
