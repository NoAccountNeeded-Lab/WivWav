'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ChevronLeft } from 'lucide-react'
import styles from './page.module.css'

export function BackButton() {
  const router = useRouter()
  const t = useTranslations('ListingDetail')
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={styles.back}
      aria-label={t('backAriaLabel')}
    >
      <ChevronLeft size={20} aria-hidden />
    </button>
  )
}
