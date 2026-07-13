import { ChartContainer, ChartLegendContent } from '@wivwav/web'

// ChartLegendContent is the presentational half of the legend pair — driven
// by an explicit `payload` prop and useChart() context, with no dependency
// on Recharts' internal chart context (unlike ChartLegend, a bare
// RechartsPrimitive.Legend that only renders inside a live chart — see
// ChartLegend.tsx / learnings/batchB.md for why a real recharts chart can't
// be composed in this harness). Shown here above/below hand-drawn static
// donut-style breakdowns standing in for the missing live chart.

const config = {
  dealer: { label: 'Dealer', color: '#2563eb' },
  private: { label: 'Private seller', color: '#f59e0b' },
}

function SellerTypeDonut() {
  const dealerPct = 68
  const r = 60
  const c = 2 * Math.PI * r
  return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      <circle cx={80} cy={80} r={r} fill="none" stroke="#fde68a" strokeWidth={20} />
      <circle
        cx={80}
        cy={80}
        r={r}
        fill="none"
        stroke="#2563eb"
        strokeWidth={20}
        strokeDasharray={`${(dealerPct / 100) * c} ${c}`}
        transform="rotate(-90 80 80)"
      />
      <text x={80} y={85} textAnchor="middle" fontSize={20} fontWeight={700} fill="#111827">
        {dealerPct}%
      </text>
    </svg>
  )
}

export function Default() {
  return (
    <ChartContainer config={config} style={{ width: 260, height: 240, aspectRatio: 'auto', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 260 }}>
        <SellerTypeDonut />
        <ChartLegendContent
          payload={[
            { value: 'dealer', dataKey: 'dealer', color: '#2563eb' },
            { value: 'private', dataKey: 'private', color: '#f59e0b' },
          ]}
        />
      </div>
    </ChartContainer>
  )
}

export function TopAligned() {
  return (
    <ChartContainer config={config} style={{ width: 260, height: 240, aspectRatio: 'auto', justifyContent: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 260 }}>
        <ChartLegendContent
          verticalAlign="top"
          payload={[
            { value: 'dealer', dataKey: 'dealer', color: '#2563eb' },
            { value: 'private', dataKey: 'private', color: '#f59e0b' },
          ]}
        />
        <SellerTypeDonut />
      </div>
    </ChartContainer>
  )
}
