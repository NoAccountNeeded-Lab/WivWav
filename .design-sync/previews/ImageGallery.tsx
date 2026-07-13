import { ImageGallery } from '@wivwav/web'

// Inline SVG "photos" so the gallery renders deterministically without any
// network access. Each one is a distinct color + caption standing in for a
// real listing photo (exterior, interior, ramp, etc.).
function photo(label: string, bg: string, fg = '#ffffff'): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">
    <rect width="800" height="450" fill="${bg}"/>
    <text x="400" y="235" font-family="system-ui, sans-serif" font-size="34" fill="${fg}" text-anchor="middle">${label}</text>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const vanPhotos = [
  photo('2021 Toyota Sienna — Exterior', '#8a5a2b'),
  photo('In-floor ramp deployed', '#4a6b57'),
  photo('Lowered floor + power seat', '#3d5a80'),
  photo('Interior — driver console', '#6b4e71'),
  photo('Rear cargo / wheelchair area', '#7a3b3b'),
]

export function Default() {
  return <ImageGallery images={vanPhotos} alt="2021 Toyota Sienna Autobot conversion" />
}

export function SinglePhoto() {
  return (
    <ImageGallery
      images={[photo('2019 Honda Odyssey — Side ramp', '#8a5a2b')]}
      alt="2019 Honda Odyssey side-entry conversion"
    />
  )
}

export function NoPhotosAvailable() {
  return <ImageGallery images={[]} alt="2018 Dodge Grand Caravan rear-entry conversion" />
}

export function WithOverlays() {
  return (
    <ImageGallery
      images={vanPhotos}
      alt="2021 Toyota Sienna Autobot conversion"
      topOverlay={
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.6rem',
            borderRadius: '999px',
            background: 'var(--clr-primary)',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          New listing
        </span>
      }
      bottomOverlay={
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            background: 'rgba(0,0,0,0.65)',
            color: '#fff',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}
        >
          $38,900
        </span>
      }
    />
  )
}
