import { BottomSheet } from '@wivwav/web'

// NOTE: BottomSheet's CSS becomes a static, non-fixed content column at
// widths >= 768px (see BottomSheet.module.css's `@media (min-width: 768px)`
// block) — the drag handle hides and all three snap states render
// identically once the mobile bottom-sheet chrome is off. The design-sync
// capture viewport is 900x700, so this preview shows the real desktop
// composition (a two-column vehicle-detail layout) rather than three
// visually-identical "snap" variants that would only differ on a phone-width
// viewport this harness can't produce. See learnings/batchB.md.

function VehicleDetails() {
  return (
    <div style={{ padding: '4px 20px 24px' }}>
      <h2 style={{ margin: '0 0 4px', font: '600 20px system-ui' }}>
        2021 Toyota Sienna Autobot VMI
      </h2>
      <p style={{ margin: '0 0 16px', color: '#6b7280', font: '14px system-ui' }}>
        34,200 miles &middot; Columbus, OH
      </p>
      <div style={{ font: '700 24px system-ui', marginBottom: 16 }}>$38,900</div>
      <ul style={{ margin: 0, paddingLeft: 20, font: '14px system-ui', color: '#374151', lineHeight: 1.7 }}>
        <li>In-floor ramp, 6-way power transfer seat</li>
        <li>Lowered floor, automatic sliding door</li>
        <li>1 owner, clean title, no accidents reported</li>
      </ul>
    </div>
  )
}

function CompactDetails() {
  return (
    <div style={{ padding: '4px 20px 24px' }}>
      <h2 style={{ margin: '0 0 4px', font: '600 20px system-ui' }}>
        2019 Honda Odyssey BraunAbility
      </h2>
      <p style={{ margin: '0 0 16px', color: '#6b7280', font: '14px system-ui' }}>
        58,410 miles &middot; Dayton, OH
      </p>
      <div style={{ font: '700 24px system-ui' }}>$29,250</div>
    </div>
  )
}

export function Default() {
  return (
    <div
      style={{
        display: 'flex',
        height: 520,
        background: '#111827',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: '1 1 55%',
          background:
            'linear-gradient(135deg, #1f2937 0%, #374151 60%, #4b5563 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)',
          font: '600 14px system-ui',
        }}
      >
        Vehicle photo
      </div>
      <div style={{ flex: '1 1 45%', display: 'flex', minWidth: 0 }}>
        <BottomSheet defaultSnap="full">
          <VehicleDetails />
        </BottomSheet>
      </div>
    </div>
  )
}

export function ShortListing() {
  return (
    <div
      style={{
        display: 'flex',
        height: 320,
        background: '#111827',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: '1 1 55%',
          background:
            'linear-gradient(135deg, #1f2937 0%, #374151 60%, #4b5563 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255,255,255,0.5)',
          font: '600 14px system-ui',
        }}
      >
        Vehicle photo
      </div>
      <div style={{ flex: '1 1 45%', display: 'flex', minWidth: 0 }}>
        <BottomSheet defaultSnap="mid">
          <CompactDetails />
        </BottomSheet>
      </div>
    </div>
  )
}
