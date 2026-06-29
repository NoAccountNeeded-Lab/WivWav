import styles from './WavFeatureItem.module.css'

interface WavFeatureItemProps {
  icon: React.ReactNode
  label: string
  value: string
}

export function WavFeatureItem({ icon, label, value }: WavFeatureItemProps) {
  return (
    <div role="listitem" className={styles.item}>
      <div className={styles.icon}>{icon}</div>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  )
}
