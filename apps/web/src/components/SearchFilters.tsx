'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback, useTransition } from 'react'
import { buildSearchHref } from '@/lib/results-url'
import { useTranslations } from 'next-intl'
import styles from './SearchFilters.module.css'

export function SortSelect() {
  const t = useTranslations('SearchFilters')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const sort = searchParams.get('sort') ?? 'listedAt:desc'

  const push = useCallback(
    (updates: Record<string, string | null>) => {
      startTransition(() => {
        router.push(buildSearchHref(pathname, searchParams, updates, true), {
          scroll: false,
        })
      })
    },
    [router, pathname, searchParams],
  )

  return (
    <div className={styles.sortGroup}>
      <label htmlFor="sort-select" className={styles.sortLabel}>
        {t('sortLabel')}
      </label>
      <select
        id="sort-select"
        className={styles.sortSelect}
        value={sort}
        onChange={(e) => push({ sort: e.target.value })}
      >
        <option value="listedAt:desc">{t('sortOptions.newestListings')}</option>
        <option value="priceCents:asc">{t('sortOptions.priceLowToHigh')}</option>
        <option value="priceCents:desc">{t('sortOptions.priceHighToLow')}</option>
        <option value="mileage:asc">{t('sortOptions.lowestMileage')}</option>
        <option value="year:desc">{t('sortOptions.yearNewestFirst')}</option>
      </select>
    </div>
  )
}
