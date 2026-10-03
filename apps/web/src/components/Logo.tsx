import styles from './Logo.module.css'

interface LogoProps {
  className?: string
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`${styles.logo}${className ? ` ${className}` : ''}`}>
      {/* eslint-disable-next-line i18next/no-literal-string -- WivWav brand wordmark; not translated */}
      Wiv<span className={styles.accent}>Wav</span>
    </span>
  )
}
