import styles from './helm-sections.module.css'

interface ViewSwitchProps {
  label: string
  views: readonly { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}

/** Segmented toggle between readings of the same data. A real button group: each button is Tab-reachable and announces pressed state. */
export function ViewSwitch({ label, views, value, onChange }: ViewSwitchProps) {
  return (
    <div role="group" aria-label={label} className={styles.viewSwitch}>
      {views.map(view => (
        <button key={view.id} type="button" className={styles.viewButton} aria-pressed={view.id === value} onClick={() => onChange(view.id)}>
          {view.label}
        </button>
      ))}
    </div>
  )
}
