// Ingest pipeline — each queue can run independently, but stages produce input for the next:
//   source-scrape → detail-crawl → detail-extract → geocode → deduplicate
//
// Enrichment queues (not yet wired):
//   dealer-enrich
export const QUEUES = {
  SOURCE_SCRAPE:                        'source-scrape',
  DETAIL_CRAWL:                         'detail-crawl',
  DETAIL_EXTRACT:                       'detail-extract',
  GEOCODE:                              'geocode',
  DEDUPLICATE:                          'deduplicate',
  VIN_ENRICH:                           'vin-enrich',
  NHTSA_RECALLS:                        'nhtsa-recalls',
  NHTSA_COMPLAINTS:                     'nhtsa-complaints',
  NHTSA_SAFETY_RATINGS:                 'nhtsa-safety-ratings',
  NHTSA_INVESTIGATIONS:                 'nhtsa-investigations',
  NHTSA_MANUFACTURER_COMMUNICATIONS:    'nhtsa-manufacturer-communications',
  DEALER_ENRICH:                        'dealer-enrich',
  VEHICLE_STATS_REFRESH:                'vehicle-stats-refresh',
  MODEL_RESEARCH:                       'model-research',
  LISTING_SYNC:                         'listing-sync',
  LISTING_RESOLVE:                      'listing-resolve',
  RAWPAGE_CLEANUP:                      'rawpage-cleanup',
  CONVERSION_BRANDS_SEED:               'conversion-brands-seed',
  NMEDA_DEALERS_SEED:                   'nmeda-dealers-seed',
  FUELECONOMY_MSRP:                      'fueleconomy-msrp',
} as const

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES]
