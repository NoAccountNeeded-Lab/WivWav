import type { BacklogRow } from './flow-model'
import styles from './helm-sections.module.css'

interface BacklogBarsProps {
  rows: BacklogRow[] | null
  asOf: Date | null
}

/**
 * Horizontal queue-backlog bars with the exact numbers in an adjacent table.
 * Bars encode waiting + active + delayed and share one scale (the largest
 * backlog), so lengths are comparable between queues. This is a current
 * snapshot, not a trend.
 */
export function BacklogBars({ rows, asOf }: BacklogBarsProps) {
  const heading = 'Queue backlog right now'
  if (rows === null) {
    return (
      <div className={styles.chartBlock}>
        <h3 className={styles.chartTitle}>{heading}</h3>
        <p className={styles.empty}>Queue data is unavailable, so backlog is unknown (not zero).</p>
      </div>
    )
  }
  const max = Math.max(1, ...rows.map(row => row.total))
  const window = `Current waiting + active + delayed jobs${asOf ? `, as of ${asOf.toLocaleTimeString()}` : ''}. Not a trend.`
  return (
    <div className={styles.chartBlock}>
      <h3 className={styles.chartTitle}>{heading}</h3>
      <p className={styles.note}>{window}</p>
      {rows.length === 0 ? (
        <p className={styles.empty}>No queue has pending work.</p>
      ) : (
        <>
          <ul className={styles.barRows} aria-hidden="true">
            {rows.map(row => (
              <li key={row.queue} className={styles.barRow}>
                <span className={styles.barLabel}>{row.queue}</span>
                <span className={styles.barTrack}>
                  <span className={styles.barFill} style={{ display: 'block', width: `${Math.max(2, Math.round((row.total / max) * 100))}%` }} />
                </span>
                <span className={styles.barValue}>{row.total.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          <table className={styles.dataTable}>
            <caption>Backlog by queue (numbers behind the bars)</caption>
            <thead>
              <tr><th scope="col">Queue</th><th scope="col">Waiting</th><th scope="col">Active</th><th scope="col">Delayed</th><th scope="col">Total</th></tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.queue}>
                  <th scope="row">{row.queue}</th>
                  <td data-numeric="true">{row.waiting.toLocaleString()}</td>
                  <td data-numeric="true">{row.active.toLocaleString()}</td>
                  <td data-numeric="true">{row.delayed.toLocaleString()}</td>
                  <td data-numeric="true">{row.total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
