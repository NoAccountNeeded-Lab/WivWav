import { ProvenanceBadge } from '@wivwav/web'

export function Default() {
  return (
    <ProvenanceBadge
      provenance={{
        sourceName: 'Rollx Vans',
        sourceBaseUrl: 'rollxvans.com',
        sourceUrl: 'https://rollxvans.com/inventory/2021-toyota-sienna-12345',
        buyerUrl: 'https://rollxvans.com/inventory/2021-toyota-sienna-12345',
        scrapedAt: '2024-05-14T08:00:00Z',
        detailScrapedAt: '2024-05-14T08:05:00Z',
        vehicleModelMatchConfidence: 'high',
      }}
    />
  )
}

export function SourceUrlOnlyNoBuyerLink() {
  return (
    <ProvenanceBadge
      provenance={{
        sourceName: 'AMS Vans',
        sourceBaseUrl: 'amsvans.com',
        sourceUrl: 'https://amsvans.com/listings/dodge-grand-caravan-67890',
        buyerUrl: null,
        scrapedAt: '2024-05-13T14:30:00Z',
        detailScrapedAt: null,
        vehicleModelMatchConfidence: null,
      }}
    />
  )
}

export function NoLinkableUrl() {
  return (
    <ProvenanceBadge
      provenance={{
        sourceName: 'Mobility Works',
        sourceBaseUrl: 'mobilityworks.com',
        sourceUrl: 'ftp://internal.mobilityworks.com/feed/9981',
        buyerUrl: null,
        scrapedAt: '2024-05-12T11:00:00Z',
        detailScrapedAt: null,
        vehicleModelMatchConfidence: null,
      }}
    />
  )
}

export function MissingProvenance() {
  return <ProvenanceBadge provenance={null} />
}
