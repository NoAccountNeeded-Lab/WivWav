import type { NextConfig } from 'next'
import { getSecurityHeadersConfig } from './src/lib/security-headers'

const config: NextConfig = {
  output: 'standalone',
  // @wivwav/charts also barrels BarChart/DonutChart/RangeSlider, which pull in
  // recharts/@radix-ui/react-slider. Per-import rewriting keeps the unused ones
  // out of the lazy-loaded chunks; /helm uses StackedBarList and ScrapeRunChart.
  experimental: {
    optimizePackageImports: ['@wivwav/charts'],
  },
  async headers() {
    return getSecurityHeadersConfig(process.env.NODE_ENV)
  },
}

export default config
