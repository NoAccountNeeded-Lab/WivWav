/**
 * US state/territory name ⇄ USPS abbreviation lookup.
 *
 * Names match the `properties.name` values in the `us-atlas` states-10m
 * topojson (public domain US Census TIGER/Line data) bundled at
 * `apps/web/public/data/us-states-10m.json`, so this map can translate
 * geography features directly into the abbreviations used by the listings
 * `state` field (see `packages/db/prisma/schema.prisma`).
 */
export const US_STATE_NAME_TO_ABBR: Readonly<Record<string, string>> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  // Territories present in the topojson but outside the geoAlbersUsa
  // projection's coverage (Continental US + AK + HI insets only). Kept here
  // so lookups against the feature set stay exhaustive, even though the
  // heat map never surfaces them as clickable choropleth regions.
  'American Samoa': 'AS',
  Guam: 'GU',
  'Commonwealth of the Northern Mariana Islands': 'MP',
  'Puerto Rico': 'PR',
  'United States Virgin Islands': 'VI',
}

export const US_TERRITORY_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'AS',
  'GU',
  'MP',
  'PR',
  'VI',
])
