import Link from 'next/link'
import type { ReactNode } from 'react'
import opsStyles from '../app/ops/ops.module.css'

interface OpsRouteLoadingProps {
  /** Static page title — identical to the real page's `<h1>`, so there is no text swap once data loads. */
  title: string
  /** Static intro copy — identical to the real page's intro paragraph. */
  intro: string
  backHref: string
  backLabel: string
  children: ReactNode
}

/**
 * Shared `loading.tsx` shell for `/ops/*` sub-pages (E5, issue #732).
 *
 * The header is not a skeleton — title, intro, and back-link text are static
 * per route and identical to what the real client component renders, so
 * reusing them here (rather than a placeholder block) means the header
 * never shifts or re-paints once the real page mounts. Only `children`
 * (the data-dependent body) should be a skeleton.
 */
export function OpsRouteLoading({ title, intro, backHref, backLabel, children }: OpsRouteLoadingProps) {
  return (
    <main id="main-content" className={opsStyles.main}>
      <div className={opsStyles.container}>
        <div className={opsStyles.pageHeader}>
          <div>
            <h1 className={opsStyles.heading}>{title}</h1>
            <p className={opsStyles.pageIntro}>{intro}</p>
          </div>
          <Link href={backHref} className={opsStyles.backLink}>{backLabel}</Link>
        </div>
        {children}
      </div>
    </main>
  )
}
