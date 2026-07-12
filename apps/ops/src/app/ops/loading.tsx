import styles from './page.module.css'

/**
 * Shown in place of the routed page content while a nested /ops/* route
 * segment loads (code-split chunk + RSC payload), while OpsShell's header
 * and nav stay mounted — so navigating between sections feels like an
 * in-app transition rather than a full page reload. Sized to roughly match
 * a page's hero + first content block so the swap doesn't visibly jump.
 */
export default function OpsLoading() {
  return (
    <main id="main-content" aria-busy="true" aria-live="polite" className={styles.main}>
      <div className={styles.loadingPanel}>Loading…</div>
    </main>
  )
}
