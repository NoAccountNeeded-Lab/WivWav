import type { NextConfig } from 'next'
import { getSecurityHeadersConfig } from './src/lib/security-headers'

const config: NextConfig = {
  output: 'standalone',
  async headers() {
    return getSecurityHeadersConfig()
  },
}

export default config
