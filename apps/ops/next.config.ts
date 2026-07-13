import type { NextConfig } from 'next'
import { getSecurityHeadersConfig } from './src/lib/security-headers'

const config: NextConfig = {
  output: 'standalone',
  // ScrapeRunChart is the only @wivwav/charts export ops uses today; the
  // package also barrels BarChart/DonutChart/RangeSlider, which pull in
  // recharts/@radix-ui/react-slider. Without per-import rewriting those
  // would ride along in the lazy-loaded overview chunk that exists
  // specifically to keep heavy client code off the initial bundle.
  experimental: {
    optimizePackageImports: ['@wivwav/charts'],
  },
  async headers() {
    return getSecurityHeadersConfig()
  },
}

export default config
