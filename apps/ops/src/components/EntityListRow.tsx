import type { ReactNode } from 'react'
import Link from 'next/link'
import styles from './EntityListRow.module.css'

interface EntityListProps {
  ariaLabel: string
  children: ReactNode
}

interface EntityMetaItemProps {
  children: ReactNode
  emphasis?: boolean
}

interface EntityListRowProps {
  icon: ReactNode
  title: string
  href?: string
  status?: ReactNode
  secondary?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  feedback?: ReactNode
  feedbackIsError?: boolean
  expandedContent?: ReactNode
  ariaLabel: string
  dimmed?: boolean
}

export function EntityList({ ariaLabel, children }: EntityListProps) {
  return <ul className={styles.list} aria-label={ariaLabel}>{children}</ul>
}

export function EntityMetaItem({ children, emphasis = false }: EntityMetaItemProps) {
  return (
    <span className={styles.metaItem} data-emphasis={emphasis ? 'true' : undefined}>
      {children}
    </span>
  )
}

export function EntityListRow({
  icon,
  title,
  href,
  status,
  secondary,
  meta,
  actions,
  feedback,
  feedbackIsError = false,
  expandedContent,
  ariaLabel,
  dimmed = false,
}: EntityListRowProps) {
  const titleNode = href
    ? <Link href={href} className={styles.primary}>{title}</Link>
    : <span className={styles.primary}>{title}</span>

  return (
    <li className={styles.row} aria-label={ariaLabel} data-dimmed={dimmed ? 'true' : undefined}>
      <div className={styles.main}>
        <div className={styles.iconWrap} aria-hidden="true">{icon}</div>
        <div className={styles.content}>
          <div className={styles.headline}>
            <div>
              {titleNode}
              {secondary ? <p className={styles.secondary}>{secondary}</p> : null}
            </div>
            {status}
          </div>
          {meta ? <div className={styles.meta}>{meta}</div> : null}
        </div>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      {feedback ? (
        <div className={styles.feedback} data-error={feedbackIsError ? 'true' : undefined}>
          {feedback}
        </div>
      ) : null}
      {expandedContent ? (
        <div className={styles.expanded}>
          <div className={styles.expandedInner}>{expandedContent}</div>
        </div>
      ) : null}
    </li>
  )
}

export { styles as entityListRowStyles }
