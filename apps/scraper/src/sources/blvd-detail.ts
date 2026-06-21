import type { BrowserPage } from '../browser/index.js'
import type { RampType, SaleStatus, WavFeature } from '@wivwav/types'
import { parseSaleStatus } from '../lib/sale-status.js'
export type { SaleStatus } from '@wivwav/types'

const BASE_URL = 'https://www.blvd.com'

export interface RawDetail {
  specs: Record<string, string>
  descriptionText: string
  imageUrls: string[]
  dealerPhone: string
  dealerAddressText: string
  statusBannerText: string
}

export interface BlvdDetailFields {
  color: string | null
  fuelType: string | null
  transmission: string | null
  rampType: RampType
  wavFeatures: WavFeature[]
  floorLoweringInches: number | null
  wheelchairCapacity: number | null
  description: string | null
  images: string[]
  zip: string | null
  dealerPhone: string | null
  saleStatus: SaleStatus
}

export function parseRampType(text: string): RampType {
  const t = text.toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor')) return 'in_floor'
  if (t.includes('fold out') || t.includes('fold-out')) return 'fold_out'
  if (t.includes('fold in') || t.includes('fold-in')) return 'fold_in'
  return 'unknown'
}

export function parseFloorLowering(text: string): number | null {
  // "14 inch floor lowering" / "14" floor lowering" / "floor lowered 10 inches"
  const before = text.match(/(\d+)\s*(?:"|in\.?|inch(?:es)?)\s+floor\s*(?:low|drop)/i)
  if (before) return parseInt(before[1]!, 10)
  const after = text.match(/floor\s*(?:low\w*|drop\w*)\s+(?:of\s+)?(\d+)/i)
  if (after) return parseInt(after[1]!, 10)
  return null
}

export function parseZip(address: string): string | null {
  const m = address.match(/\b(\d{5})\b/)
  return m ? m[1]! : null
}

export function parseBlvdDetail(raw: RawDetail): BlvdDetailFields {
  const spec = (key: string): string | null => raw.specs[key]?.trim() || null
  const desc = raw.descriptionText
  const t = desc.toLowerCase()

  const wavFeatures: WavFeature[] = []
  if (/\blift\b/i.test(desc)) wavFeatures.push('has_lift')
  if (/hand\s+control/i.test(t)) wavFeatures.push('hand_controls')
  if (/transfer\s+seat/i.test(t)) wavFeatures.push('transfer_seat')
  if (/lowered?\s+floor|floor\s+(?:low|drop)/i.test(t)) wavFeatures.push('lowered_floor')
  if (/power\s+ramp/i.test(t)) wavFeatures.push('power_ramp')
  if (/kneel\s+system|kneeling/i.test(t)) wavFeatures.push('kneel_system')
  if (/tie[-\s]?down/i.test(t)) wavFeatures.push('tie_down_system')
  if (/automatic\s+door/i.test(t)) wavFeatures.push('automatic_door')
  if (/motorized\s+running\s+board/i.test(t)) wavFeatures.push('motorized_running_board')

  return {
    color: spec('Color'),
    fuelType: spec('Engine'),
    transmission: spec('Transmission'),
    rampType: parseRampType(desc),
    wavFeatures,
    floorLoweringInches: parseFloorLowering(desc),
    wheelchairCapacity: null,
    description: desc || null,
    images: raw.imageUrls,
    zip: parseZip(raw.dealerAddressText),
    dealerPhone: raw.dealerPhone || null,
    saleStatus: parseSaleStatus(raw.statusBannerText),
  }
}

export async function evaluateBlvdDetail(page: BrowserPage): Promise<RawDetail> {
  return page.evaluate(function (baseUrl: string): RawDetail {
    // Specs: table rows with label in first td, value in second td
    const specs: Record<string, string> = {}
    document.querySelectorAll('table tr').forEach(function (tr) {
      const cells = Array.from(tr.querySelectorAll('td'))
      if (cells.length >= 2) {
        const label = cells[0]?.textContent?.trim()
        const value = cells[1]?.textContent?.trim()
        if (label && value) specs[label] = value
      }
    })

    // Description: walk up from "Vehicle Description" h2 to find a <p> in its ancestor
    let descriptionText = ''
    const descH2 = Array.from(document.querySelectorAll('h2')).find(function (h) {
      return /Vehicle Description/i.test(h.textContent ?? '')
    })
    if (descH2) {
      let node: Element | null = descH2
      while (node.parentElement) {
        node = node.parentElement
        const p = node.querySelector('p')
        if (p?.textContent && p.textContent.length > 50) {
          descriptionText = p.textContent.trim()
          break
        }
      }
    }

    // Gallery: all <a href> links pointing to large images, deduped.
    // The _large.jpg pattern is vehicle-gallery-specific; the path filter guards edge cases.
    const NON_VEHICLE_PATH =
      /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker)\b/i
    const seen = new Set<string>()
    const imageUrls: string[] = []
    document.querySelectorAll<HTMLAnchorElement>('a[href*="_large.jpg"]').forEach(function (a) {
      const href = a.getAttribute('href') ?? ''
      if (!href || NON_VEHICLE_PATH.test(href)) return
      const abs = href.startsWith('http') ? href : `${baseUrl}${href}`
      if (!seen.has(abs)) { seen.add(abs); imageUrls.push(abs) }
    })

    // Dealer phone from tel: link
    const phoneEl = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]')
    const dealerPhone = phoneEl?.textContent?.trim() ?? ''

    // Dealer address / zip from the seller sidebar block
    const sidebar = document.querySelector('.sidebarfeature') as HTMLElement | null
    const dealerAddressText = sidebar?.innerText?.replace(/\s+/g, ' ').trim() ?? ''

    // Sale status banner: sold/pending overlays that appear on detail pages
    // BLVD uses a ribbon or badge element with class containing "sold", "pending", or "status"
    const bannerCandidates = [
      document.querySelector('[class*="sold"]'),
      document.querySelector('[class*="pending"]'),
      document.querySelector('[class*="unavailable"]'),
      document.querySelector('[class*="status-badge"]'),
      document.querySelector('[class*="sale-status"]'),
    ]
    const statusBannerEl = bannerCandidates.find(function (el) { return el !== null }) ?? null
    const statusBannerText = statusBannerEl?.textContent?.trim() ?? ''

    return { specs, descriptionText, imageUrls, dealerPhone, dealerAddressText, statusBannerText }
  }, BASE_URL)
}
