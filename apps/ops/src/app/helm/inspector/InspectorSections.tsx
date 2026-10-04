import type { ReactNode } from 'react'
import styles from './helm-inspector.module.css'

/** The four fixed inspector sections, in the same order for every kind of selection. */
export function InspectorSection({ title, children }: { title: 'What happened' | 'Impact' | 'Evidence' | 'Actions'; children: ReactNode }) {
  return (
    <section className={styles.inspectorSection} aria-label={title}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

/** Raw payloads and stacks stay collapsed until the operator asks for them. */
export function TechnicalDetails({ label = 'Technical details', children }: { label?: string; children: ReactNode }) {
  return (
    <details className={styles.technical}>
      <summary>{label}</summary>
      {children}
    </details>
  )
}

export function Facts({ items }: { items: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className={styles.facts}>
      {items.map(([term, value]) => (
        <div key={term} className={styles.fact}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
