import { ChartContainer, ChartLegendContent } from '@wivwav/web'

// ChartLegend is a bare re-export of Recharts' <Legend> primitive (see
// apps/web/src/components/ui/chart.tsx). Like ChartTooltip, it renders
// nothing on its own outside a live recharts chart (confirmed empirically —
// passing an explicit `payload` + `content` still produces a blank cell), and
// recharts isn't resolvable from this preview harness to compose a live
// chart around it — see learnings/batchB.md. ChartLegendContent (the part
// that paints anything) is shown directly beneath a hand-drawn static bar
// chart standing in for the missing live chart surface.

const config = {
  listings: { label: 'Active listings', color: '#2563eb' },
  sold: { label: 'Sold this month', color: '#16a34a' },
}

function StaticBars() {
  const data = [
    { month: 'Mar', listings: 210, sold: 28 },
    { month: 'Apr', listings: 195, sold: 31 },
    { month: 'May', listings: 240, sold: 26 },
    { month: 'Jun', listings: 232, sold: 34 },
  ]
  const max = 260
  const w = 400
  const h = 160
  const groupW = 70
  return (
    <svg width={w} height={h + 20}>
      {data.map((d, i) => {
        const x = 20 + i * groupW
        return (
          <g key={d.month}>
            <rect x={x} y={h - (d.listings / max) * h} width={22} height={(d.listings / max) * h} rx={3} fill="#2563eb" />
            <rect x={x + 26} y={h - (d.sold / max) * h} width={22} height={(d.sold / max) * h} rx={3} fill="#16a34a" />
            <text x={x + 24} y={h + 16} textAnchor="middle" fontSize={12} fill="#6b7280">{d.month}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function Default() {
  return (
    <ChartContainer
      config={config}
      style={{ width: 440, height: 260, aspectRatio: 'auto', justifyContent: 'flex-start' }}
    >
      <div style={{ display: 'block', width: 440 }}>
        <StaticBars />
        <ChartLegendContent
          payload={[
            { value: 'listings', dataKey: 'listings', color: '#2563eb' },
            { value: 'sold', dataKey: 'sold', color: '#16a34a' },
          ]}
        />
      </div>
    </ChartContainer>
  )
}
