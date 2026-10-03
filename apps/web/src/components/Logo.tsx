import styles from './Logo.module.css'

interface LogoProps {
  className?: string
}

export function Logo({ className }: LogoProps) {
  return (
    /* eslint-disable i18next/no-literal-string -- WivWav brand wordmark; not translated */
    <span className={`${styles.logo}${className ? ` ${className}` : ''}`}>
      Wiv<span className={styles.accent}>Wav</span>
    </span>
    /* eslint-enable i18next/no-literal-string */
  )
}
