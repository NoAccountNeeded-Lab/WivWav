'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { useRouter } from '@/navigation'
import styles from './page.module.css'

interface VinSearchFormProps {
  initialVin?: string
}

export function VinSearchForm({ initialVin = '' }: VinSearchFormProps) {
  const router = useRouter()
  const t = useTranslations('VinLookup.form')
  const [vin, setVin] = useState(initialVin)

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedVin = vin.trim().toUpperCase()
    if (!normalizedVin) return
    router.push(`/vin/${encodeURIComponent(normalizedVin)}`)
  }

  return (
    <form className={styles.searchForm} onSubmit={onSubmit}>
      <label htmlFor="vin-search" className={styles.searchLabel}>{t('label')}</label>
      <div className={styles.searchRow}>
        <input
          id="vin-search"
          className={styles.searchInput}
          value={vin}
          onChange={(event) => setVin(event.target.value)}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={17}
          placeholder={t('placeholder')}
        />
        <button type="submit" className={styles.searchButton}>
          <Search size={18} aria-hidden />
          {t('submit')}
        </button>
      </div>
    </form>
  )
}
