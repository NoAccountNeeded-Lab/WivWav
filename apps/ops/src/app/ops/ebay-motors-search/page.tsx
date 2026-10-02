import type { Metadata } from 'next'
import { opsPageTitle } from '@/lib/ops-title'
import { EbayMotorsSearchClient } from './EbayMotorsSearchClient'

export const metadata: Metadata = {
  title: opsPageTitle('eBay Motors keyword tester'),
}

export default function EbayMotorsSearchPage() {
  return <EbayMotorsSearchClient />
}
