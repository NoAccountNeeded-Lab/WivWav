import { ChartContainer, ChartTooltipContent } from '@wivwav/web'

// ChartTooltipContent is the presentational half of the tooltip pair — it's
// a plain component driven by `payload`/`label` props and useChart() context,
// with no dependency on Recharts' Layer/coordinate system (unlike its sibling
// ChartTooltip, which is a bare RechartsPrimitive.Tooltip and only renders
// inside a live chart — see ChartTooltip.tsx / learnings/batchB.md for why a
// real recharts chart can't be composed in this harness). So it's previewed
// directly here, pinned "active" over a hand-drawn static line chart,
// demonstrating its multi-series and single-series layouts.

const config = {
  listings: { label: 'Active listings', color: '#2563eb' },
  sold: { label: 'Sold this month', color: '#16a34a' },
}

function StaticLineChart() {
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun']
  const listings = [180, 210, 195, 240, 232]
  const sold = [22, 28, 31, 26, 34]
  const w = 420
  const h = 180
  const toPoints = (vals: number[], max: number) =>
    vals.map((v, i) => `${24 + i * ((w - 48) / (vals.length - 1))},${h - (v / max) * (h - 24)}`).join(' ')
  return (
    <svg width={w} height={h + 24}>
      <polyline points={toPoints(listings, 260)} fill="none" stroke="#2563eb" strokeWidth={2.5} />
      <polyline points={toPoints(sold, 260)} fill="none" stroke="#16a34a" strokeWidth={2.5} />
      {months.map((m, i) => (
        <text key={m} x={24 + i * ((w - 48) / (months.length - 1))} y={h + 18} textAnchor="middle" fontSize={12} fill="#6b7280">
          {m}
        </text>
      ))}
      <line x1={24 + 3 * ((w - 48) / 4)} y1={0} x2={24 + 3 * ((w - 48) / 4)} y2={h} stroke="#e5e7eb" strokeDasharray="3 3" />
    </svg>
  )
}

export function MultiSeries() {
  return (
    <ChartContainer config={config} style={{ width: 460, height: 220, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <StaticLineChart />
        <div style={{ position: 'absolute', top: 8, left: 300 }}>
          <ChartTooltipContent
            active
            label="May"
            payload={[
              { dataKey: 'listings', name: 'listings', value: 240, color: '#2563eb' },
              { dataKey: 'sold', name: 'sold', value: 26, color: '#16a34a' },
            ]}
          />
        </div>
      </div>
    </ChartContainer>
  )
}

export function SingleSeriesLineIndicator() {
  return (
    <ChartContainer config={config} style={{ width: 460, height: 220, position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <StaticLineChart />
        <div style={{ position: 'absolute', top: 8, left: 300 }}>
          <ChartTooltipContent
            active
            indicator="line"
            label="June"
            payload={[{ dataKey: 'listings', name: 'listings', value: 232, color: '#2563eb' }]}
          />
        </div>
      </div>
    </ChartContainer>
  )
}
