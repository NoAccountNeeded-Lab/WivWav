import { useFormatter, useTranslations } from 'next-intl'
import type { HomeSnapshot, HomeSnapshotResult } from '@/lib/home-snapshot'
import styles from './HomePage.module.css'

const TOP_STATES = 8



function Missing({ missing }: { missing: NonNullable<HomeSnapshot['missing']> }) {
  const t = useTranslations('HomePage')
  const rows = [
    { key: 'state', text: missing.state > 0 && t('missingState', { count: missing.state }) },
    { key: 'entry', text: missing.entryType > 0 && t('missingEntry', { count: missing.entryType }) },
    { key: 'price', text: missing.price > 0 && t('missingPrice', { count: missing.price }) },
  ].filter((r): r is { key: string; text: string } => r.text !== false)
  return (
    <section aria-labelledby="home-missing" className={styles.card}>
      <h2 id="home-missing" className={styles.h2}>{t('missingHeading')}</h2>
      {rows.length ? (
        <>
          <p className={styles.note}>{t('missingIntro')}</p>
          <ul className={styles.plainList}>{rows.map((r) => <li key={r.key}>{r.text}</li>)}</ul>
        </>
      ) : <p className={styles.note}>{t('missingNone')}</p>}
    </section>
  )
}

function Snapshot({ snapshot, discover }: { snapshot: HomeSnapshot; discover: string }) {
  const t = useTranslations('HomePage')
  const format = useFormatter()
  const time = format.dateTime(new Date(snapshot.calculatedAt), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
  const dollars = (n: number) => format.number(n, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 0 })
  const maxEntry = Math.max(1, ...snapshot.entryTypes.map((e) => e.count))
  return (
    <>
      <section aria-labelledby="home-snapshot" className={styles.card}>
        <h2 id="home-snapshot" className={styles.h2}>{t('snapshotHeading')}</h2>
        <p className={styles.stat}>
          <span className={styles.statValue}>{format.number(snapshot.total)}</span> {t('vehiclesAvailable')}
        </p>
        <p className={styles.note}>
          <time dateTime={snapshot.calculatedAt}>{t('calculatedAt', { time })}</time>
        </p>
      </section>

      <section aria-labelledby="home-coverage" className={styles.card}>
        <h2 id="home-coverage" className={styles.h2}>{t('coverageHeading')}</h2>
        {snapshot.states.length ? (
          <>
            <p>{t('statesCovered', { count: snapshot.states.length })}</p>
            <ul className={styles.linkList}>
              {snapshot.states.slice(0, TOP_STATES).map((s) => (
                <li key={s.value}>
                  <a href={`${discover}?state=${encodeURIComponent(s.value)}`}>{t('stateLink', { state: s.value, count: s.count })}</a>
                </li>
              ))}
            </ul>
          </>
        ) : <p className={styles.note}>{t('unavailableSection')}</p>}
      </section>

      <section aria-labelledby="home-entry" className={styles.card}>
        <h2 id="home-entry" className={styles.h2}>{t('entryHeading')}</h2>
        {snapshot.entryTypes.length ? (
          <ul className={styles.bars} aria-label={t('entryChartLabel')}>
            {snapshot.entryTypes.map((e) => (
              <li key={e.value}>
                <a href={`${discover}?conversionType=${encodeURIComponent(e.value)}`}>
                  {t.has(`entry.${e.value}`) ? t(`entry.${e.value}` as 'entry.rear_entry') : e.value.replace(/_/g, ' ')}: {format.number(e.count)}
                </a>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.fill} style={{ width: `${(e.count / maxEntry) * 100}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : <p className={styles.note}>{t('unavailableSection')}</p>}
      </section>

      <section aria-labelledby="home-budget" className={styles.card}>
        <h2 id="home-budget" className={styles.h2}>{t('budgetHeading')}</h2>
        {snapshot.budgets.length ? (
          <>
            <p className={styles.note}>{t('budgetIntro')}</p>
            <ul className={styles.linkList}>
              {snapshot.budgets.map((b) => (
                <li key={b.lo}>
                  <a href={`${discover}?priceMin=${b.lo * 100}&priceMax=${b.hi * 100 - 1}`}>
                    {t('budgetLink', { min: dollars(b.lo), max: dollars(b.hi), count: b.count })}
                  </a>
                </li>
              ))}
            </ul>
          </>
        ) : <p className={styles.note}>{t('noBudgets')}</p>}
      </section>

      {snapshot.missing && <Missing missing={snapshot.missing} />}
    </>
  )
}

export function HomeContent({ locale, result }: { locale: string; result: HomeSnapshotResult }) {
  const t = useTranslations('HomePage')
  const discover = `/${locale}/discover`
  return (
    <div className={styles.page}>
      <section aria-labelledby="home-heading" className={styles.hero}>
        <h1 id="home-heading" className={styles.h1}>{t('heading')}</h1>
        <p className={styles.lead}>{t('intro')}</p>
        <a href={discover} className={styles.cta}>{t('findVehicle')}</a>
      </section>

      {result.status === 'ok' ? (
        <Snapshot snapshot={result.snapshot} discover={discover} />
      ) : (
        <section aria-labelledby="home-snapshot" className={styles.card}>
          <h2 id="home-snapshot" className={styles.h2}>{t('snapshotHeading')}</h2>
          <p className={styles.note} role="status">{t('unavailable')}</p>
        </section>
      )}

      <section aria-labelledby="home-guide" className={styles.card}>
        <h2 id="home-guide" className={styles.h2}>{t('guideHeading')}</h2>
        <ul className={styles.plainList}>
          <li>{t('guideRear')}</li>
          <li>{t('guideSide')}</li>
          <li>{t('guideRamp')}</li>
          <li>{t('guideCheck')}</li>
        </ul>
        <a href={`${discover}?wavFeatures=has_lift`} className={styles.liftLink}>{t('guideLift')}</a>
        <p className={styles.note}>{t('safetyNote')}</p>
      </section>

      <section aria-labelledby="home-cta" className={styles.hero}>
        <h2 id="home-cta" className={styles.h2}>{t('ctaHeading')}</h2>
        <p className={styles.lead}>{t('ctaBody')}</p>
        <a href={discover} className={styles.cta}>{t('findVehicle')}</a>
      </section>
    </div>
  )
}
