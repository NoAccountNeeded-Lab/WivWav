import { ChartContainer, ChartTooltipContent } from '@wivwav/web'

// ChartTooltip is a bare re-export of Recharts' <Tooltip> primitive (see
// apps/web/src/components/ui/chart.tsx: `const ChartTooltip =
// RechartsPrimitive.Tooltip`). Recharts' Tooltip renders nothing on its own —
// it reads active/payload coordinates from the chart Layer context that only
// a live <BarChart>/<LineChart> provides (confirmed empirically: rendering
// <ChartTooltip active payload={...} content={<ChartTooltipContent/>} />
// outside a real recharts chart produces a blank cell, no crash). recharts
// itself also isn't resolvable from this preview harness (not in
// .ds-sync/consumer/node_modules), so a live chart can't be composed here at
// all — see learnings/batchB.md. ChartTooltipContent (the part that actually
// paints anything) is a plain presentational component, so it's shown
// directly here, "pinned" active, over a hand-drawn static bar chart that
// stands in for the missing live Recharts surface — the same visual result
// a hovered <ChartTooltip> would produce.

const config = {
  listings: { label: 'Active listings', color: '#2563eb' },
}

function StaticBars({ highlight }: { highlight: number }) {
  const data = [
    { make: 'Toyota', value: 142 },
    { make: 'Honda', value: 118 },
    { make: 'Dodge', value: 96 },
    { make: 'Chrysler', value: 74 },
  ]
  const max = Math.max(...data.map((d) => d.value))
  const barW = 64
  const gap = 32
  const chartH = 160
  return (
    <svg width={400} height={220}>
      {data.map((d, i) => {
        const h = (d.value / max) * chartH
        const x = 24 + i * (barW + gap)
        return (
          <g key={d.make}>
            <rect
              x={x}
              y={chartH - h + 12}
              width={barW}
              height={h}
              rx={4}
              fill={i === highlight ? '#2563eb' : '#bfdbfe'}
            />
            <text x={x + barW / 2} y={chartH + 32} textAnchor="middle" fontSize={12} fill="#6b7280">
              {d.make}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function Default() {
  return (
    <ChartContainer config={config} style={{ width: 440, height: 260, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <StaticBars highlight={0} />
        <div style={{ position: 'absolute', top: -8, left: 96 }}>
          <ChartTooltipContent
            active
            label="Toyota"
            payload={[{ dataKey: 'listings', name: 'listings', value: 142, color: '#2563eb' }]}
          />
        </div>
      </div>
    </ChartContainer>
  )
}

export function OnDodge() {
  return (
    <ChartContainer config={config} style={{ width: 440, height: 260, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <StaticBars highlight={2} />
        <div style={{ position: 'absolute', top: 24, left: 200 }}>
          <ChartTooltipContent
            active
            label="Dodge"
            payload={[{ dataKey: 'listings', name: 'listings', value: 96, color: '#2563eb' }]}
          />
        </div>
      </div>
    </ChartContainer>
  )
}
