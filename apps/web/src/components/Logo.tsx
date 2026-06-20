import styles from './Logo.module.css'

interface LogoProps {
  className?: string
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`${styles.logo}${className ? ` ${className}` : ''}`}>
      Wiv<span className={styles.accent}>Wav</span>
    </span>
  )
}
