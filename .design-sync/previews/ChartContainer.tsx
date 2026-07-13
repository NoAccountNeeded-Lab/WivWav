import { ChartContainer, ChartTooltipContent, ChartLegendContent } from '@wivwav/web'

// ChartContainer is the theming/context shell (injects --color-* CSS vars
// from `config` and wraps children in Recharts' ResponsiveContainer). recharts
// itself isn't resolvable from this preview harness (not in
// .ds-sync/consumer/node_modules), so a live BarChart/LineChart can't be
// composed as its child here — see learnings/batchB.md. This preview shows
// the container doing its real job (theming + layout shell) around a
// hand-drawn static chart that stands in for the missing live one, with its
// real tooltip/legend sub-parts composed in — the full picture a real
// <ChartContainer><BarChart>...</BarChart></ChartContainer> would produce.
//
// NOTE for anyone extending these previews: Recharts' ResponsiveContainer
// measures size asynchronously and the wrapper it renders starts at
// `width: 0; height: 0; overflow: visible` — any child that centers/aligns
// via flexbox (justify-center, align-items: center) without its OWN explicit
// width collapses toward that 0-width anchor. Give any such wrapper div an
// explicit pixel width.

const config = {
  make: { label: 'Active listings', color: '#2563eb' },
}

function MakeBars({ highlight }: { highlight: number }) {
  const data = [
    { make: 'Toyota', value: 142 },
    { make: 'Honda', value: 118 },
    { make: 'Dodge', value: 96 },
    { make: 'Chrysler', value: 74 },
    { make: 'Ford', value: 61 },
  ]
  const max = Math.max(...data.map((d) => d.value))
  const barW = 48
  const gap = 24
  const chartH = 160
  return (
    <svg width={440} height={200}>
      <line x1={16} y1={12} x2={16} y2={chartH + 12} stroke="#e5e7eb" />
      {data.map((d, i) => {
        const h = (d.value / max) * chartH
        const x = 24 + i * (barW + gap)
        return (
          <g key={d.make}>
            <rect x={x} y={chartH - h + 12} width={barW} height={h} rx={4} fill={i === highlight ? '#2563eb' : '#93c5fd'} />
            <text x={x + barW / 2} y={chartH + 32} textAnchor="middle" fontSize={12} fill="#6b7280">{d.make}</text>
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
      style={{ width: 460, height: 260, aspectRatio: 'auto', justifyContent: 'flex-start', position: 'relative' }}
    >
      <div style={{ width: 460, position: 'relative' }}>
        <MakeBars highlight={0} />
        <div style={{ position: 'absolute', top: -4, left: 20 }}>
          <ChartTooltipContent
            active
            label="Toyota"
            payload={[{ dataKey: 'make', name: 'make', value: 142, color: '#2563eb' }]}
          />
        </div>
      </div>
    </ChartContainer>
  )
}

export function WithLegend() {
  const dualConfig = {
    listings: { label: 'Active listings', color: '#2563eb' },
    sold: { label: 'Sold this month', color: '#16a34a' },
  }
  return (
    <ChartContainer
      config={dualConfig}
      style={{ width: 460, height: 300, aspectRatio: 'auto', justifyContent: 'flex-start' }}
    >
      <div style={{ width: 460 }}>
        <MakeBars highlight={-1} />
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
