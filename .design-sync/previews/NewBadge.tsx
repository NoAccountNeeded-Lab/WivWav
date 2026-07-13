import { NewBadge, ListingsVisitSession } from '@wivwav/web'

// The capture harness pins the browser clock to 2024-05-15T12:00:00Z, and
// NewBadge only shows once ListingsVisitSession has loaded a *previous*
// visit timestamp from localStorage (first-time visitors never see it). We
// seed that timestamp synchronously during render, before the provider's
// effect reads it, so the story renders in its intended state without any
// user interaction.
function seedLastVisit(iso: string) {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem('wav-last-visit', iso)
    } catch {
      // ignore
    }
  }
}

export function Default() {
  seedLastVisit('2024-05-10T09:00:00Z')
  return (
    <ListingsVisitSession>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.95rem' }}>
          2021 Toyota Sienna Autobot VMI — Rear-Entry Ramp
        </span>
        <NewBadge listedAt="2024-05-14T08:00:00Z" />
      </div>
    </ListingsVisitSession>
  )
}

export function NotNewSinceLastVisit() {
  seedLastVisit('2024-05-14T09:00:00Z')
  return (
    <ListingsVisitSession>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.95rem' }}>
          2019 Dodge Grand Caravan BraunAbility — Side-Entry Ramp
        </span>
        <NewBadge listedAt="2024-04-01T08:00:00Z" />
        <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.8rem', color: '#6b7280' }}>
          (listed before your last visit — no badge)
        </span>
      </div>
    </ListingsVisitSession>
  )
}
