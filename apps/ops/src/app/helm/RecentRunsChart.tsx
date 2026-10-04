import { ScrapeRunChart } from '@wivwav/charts'
import type { RecentRunWindow } from './flow-model'
import styles from './helm-sections.module.css'

/**
 * Recent scrape runs (existing `ScrapeRunChart`): bar height is listings
 * found by that run, colour marks pass/fail, and the table below carries the
 * exact figures and window. Run results only — no inventory trend is drawn.
 */
export function RecentRunsChart({ window }: { window: RecentRunWindow | null }) {
  const heading = 'Recent scrape runs: listings found'
  if (window === null) {
    return (
      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>{heading}</h3>
        <p className={styles.empty}>Scrape run data is unavailable.</p>
      </div>
    )
  }
  return (
    <div className={styles.chartBlock}>
      <h3 className={styles.chartTitle}>{heading}</h3>
      <p className={styles.note}>{window.windowLabel}. Bar height is listings found in that one run (oldest on the left); it is not total inventory.</p>
      <div className={styles.chartWide}>
        <ScrapeRunChart runs={window.points} maxBars={window.points.length || 1} ariaLabel={`${heading}. ${window.windowLabel}.`} />
      </div>
      {window.points.length > 0 && (
        <details className={styles.definition}>
          <summary>Show numbers for these runs</summary>
          <table className={styles.dataTable}>
            <caption>{window.windowLabel}</caption>
            <thead><tr><th scope="col">Run</th><th scope="col">Result</th><th scope="col">Listings found</th></tr></thead>
            <tbody>
              {[...window.points].reverse().map((point, index) => (
                <tr key={`${point.label}-${index}`}>
                  <th scope="row">{point.label}</th>
                  <td>{point.success === true ? 'Succeeded' : point.success === false ? 'Failed' : 'Unknown'}</td>
                  <td data-numeric="true">{point.listingsFound === null ? 'not reported' : point.listingsFound.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}
