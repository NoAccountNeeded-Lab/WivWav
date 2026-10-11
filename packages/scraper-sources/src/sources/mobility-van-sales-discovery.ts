import { BASE_URL, MAIN_BROWSE_PATH } from './mobility-van-sales-constants.js'
import { parseBrowsePageHtml } from './mobility-van-sales-parser.js'

const BROWSE_CATEGORY_PATHS = [
  'usa-handicap-vansales.html',
  'usa-mini%20van-vansales.html',
  'usa-full%20size%20van-vansales.html',
  'usa-truck-vansales.html',
  'usa-motorcycle-vansales.html',
  'usa-side%20entry-vansales.html',
  'usa-rear%20entry-vansales.html',
] as const

const BROWSE_MAKE_PATHS = [
  'toyota-wheelchair-vans-for-sale_c865.html',
  'honda-wheelchair-vans-for-sale_c865.html',
  'dodge-wheelchair-vans-for-sale_c865.html',
  'chrysler-wheelchair-vans-for-sale_c865.html',
  'ford-wheelchair-vans-for-sale_c865.html',
  'chevrolet-wheelchair-vans-for-sale_c865.html',
] as const

const STATE_SLUGS = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut',
  'delaware', 'district of columbia', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois',
  'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts',
  'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada',
  'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota',
  'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'washington',
  'west virginia', 'wisconsin', 'wyoming',
] as const

export function buildDiscoveryIndexUrls(): string[] {
  const urls = [
    `${BASE_URL}${MAIN_BROWSE_PATH}`,
    ...BROWSE_CATEGORY_PATHS.map((path) => `${BASE_URL}/used-handicap-vans/${path}`),
    ...BROWSE_MAKE_PATHS.map((path) => `${BASE_URL}/search/${path}`),
    ...STATE_SLUGS.map((slug) => `${BASE_URL}/search/find-new-used-${slug}_wheelchair-vans.html`),
  ]
  return urls
}

export function extractSecondaryBrowseUrls(html: string): string[] {
  const urls = new Set<string>()
  const pattern = /href="(\/used-handicap-vans\/[^"]+_vansales\.html)"/gi
  let match: RegExpExecArray | null
  while ((match = pattern.exec(html)) !== null) {
    const href = match[1]
    if (href) urls.add(href)
  }
  return [...urls]
}

export function extractBrowseAdIds(html: string): string[] {
  return parseBrowsePageHtml(html).map((card) => card.adId)
}

