import type { BrowserPage } from '../browser/index.js'
import type { RampType, SaleStatus, WavFeature } from '@wivwav/types'
import { parseSaleStatus } from './blvd-detail.js'

const BASE_URL = 'https://www.mobilityworks.com'

export interface RawMwDetail {
  specs: Record<string, string>
  descriptionText: string
  imageUrls: string[]
  dealerPhone: string
  dealerAddressText: string
  statusBannerText: string
}

export interface MwDetailFields {
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

export function parseMwRampType(text: string): RampType {
  const t = text.toLowerCase()
  if (t.includes('in-floor') || t.includes('in floor') || t.includes('infloor')) return 'in_floor'
  if (t.includes('fold out') || t.includes('fold-out')) return 'fold_out'
  if (t.includes('fold in') || t.includes('fold-in')) return 'fold_in'
  return 'unknown'
}

export function parseMwFloorLowering(text: string): number | null {
  const before = text.match(/(\d+)\s*(?:"|in\.?|inch(?:es)?)\s+floor\s*(?:low|drop)/i)
  if (before) return parseInt(before[1]!, 10)
  const after = text.match(/floor\s*(?:low\w*|drop\w*)\s+(?:of\s+)?(\d+)/i)
  if (after) return parseInt(after[1]!, 10)
  return null
}

export function parseMwZip(address: string): string | null {
  const m = address.match(/\b(\d{5})\b/)
  return m ? m[1]! : null
}

export function parseMwDetail(raw: RawMwDetail): MwDetailFields {
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
    color: spec('Exterior Color') ?? spec('Color'),
    fuelType: spec('Engine') ?? spec('Fuel Type'),
    transmission: spec('Transmission'),
    rampType: parseMwRampType(desc),
    wavFeatures,
    floorLoweringInches: parseMwFloorLowering(desc),
    wheelchairCapacity: null,
    description: desc || null,
    images: raw.imageUrls,
    zip: parseMwZip(raw.dealerAddressText),
    dealerPhone: raw.dealerPhone || null,
    saleStatus: parseSaleStatus(raw.statusBannerText),
  }
}

export async function evaluateMwDetail(page: BrowserPage): Promise<RawMwDetail> {
  return page.evaluate(function (baseUrl: string): RawMwDetail {
    // Specs: key-value pairs in definition lists or table rows
    const specs: Record<string, string> = {}

    // Try definition list first (dl > dt + dd)
    document.querySelectorAll('dl').forEach(function (dl) {
      const dts = Array.from(dl.querySelectorAll('dt'))
      const dds = Array.from(dl.querySelectorAll('dd'))
      dts.forEach(function (dt, i) {
        const label = dt.textContent?.trim()
        const value = dds[i]?.textContent?.trim()
        if (label && value) specs[label] = value
      })
    })

    // Also check table rows as fallback
    if (Object.keys(specs).length === 0) {
      document.querySelectorAll('table tr').forEach(function (tr) {
        const cells = Array.from(tr.querySelectorAll('td, th'))
        if (cells.length >= 2) {
          const label = cells[0]?.textContent?.trim()
          const value = cells[1]?.textContent?.trim()
          if (label && value) specs[label] = value
        }
      })
    }

    // Description: look for the vehicle description section
    let descriptionText = ''
    const descHeading = Array.from(document.querySelectorAll('h2, h3')).find(function (h) {
      return /description|about\s+this/i.test(h.textContent ?? '')
    })
    if (descHeading) {
      let node: Element | null = descHeading
      while (node?.parentElement) {
        node = node.parentElement
        const p = node.querySelector('p')
        if (p?.textContent && p.textContent.length > 50) {
          descriptionText = p.textContent.trim()
          break
        }
      }
    }
    // Fallback: first long <p> on the page (skip nav/header)
    if (!descriptionText) {
      const main = document.querySelector('main, article, [role="main"]') ?? document.body
      const p = Array.from(main.querySelectorAll('p')).find(function (el) {
        return (el.textContent?.length ?? 0) > 100
      })
      descriptionText = p?.textContent?.trim() ?? ''
    }

    // Gallery images: prefer a dedicated gallery/slider container; fall back to whole page.
    const NON_VEHICLE_PATH =
      /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker)\b/i
    const MIN_W = 200
    const MIN_H = 150
    const galleryRoot =
      document.querySelector<HTMLElement>(
        '[class*="gallery"], [class*="slider"], [class*="carousel"], [class*="photo-"], [id*="gallery"], [id*="slider"]',
      ) ??
      document.querySelector<HTMLElement>('main, article, [role="main"]') ??
      document.body
    const seen = new Set<string>()
    const imageUrls: string[] = []
    galleryRoot.querySelectorAll<HTMLImageElement>('img[data-src], img[src]').forEach(function (img) {
      const src = img.getAttribute('data-src') ?? img.getAttribute('src') ?? ''
      if (!src || src.startsWith('data:') || src.length < 10) return
      if (NON_VEHICLE_PATH.test(src)) return
      const attrW = parseInt(img.getAttribute('width') ?? '0', 10)
      const attrH = parseInt(img.getAttribute('height') ?? '0', 10)
      if (attrW > 0 && attrW < MIN_W) return
      if (attrH > 0 && attrH < MIN_H) return
      if (img.naturalWidth > 0 && img.naturalWidth < MIN_W) return
      if (img.naturalHeight > 0 && img.naturalHeight < MIN_H) return
      const abs = src.startsWith('http') ? src : `${baseUrl}${src}`
      if (!seen.has(abs) && /\.(jpg|jpeg|webp|png)/i.test(abs)) {
        seen.add(abs)
        imageUrls.push(abs)
      }
    })

    // Dealer phone from tel: link
    const phoneEl = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]')
    const dealerPhone = phoneEl?.textContent?.trim() ?? ''

    // Dealer address from address element or location block
    const addressEl = document.querySelector<HTMLElement>('address, [class*="location"], [class*="dealer-address"]')
    const dealerAddressText = addressEl?.innerText?.replace(/\s+/g, ' ').trim() ?? ''

    // Sale status banner: MobilityWorks shows overlay badges for sold/pending listings
    const bannerCandidates = [
      document.querySelector('[class*="sold"]'),
      document.querySelector('[class*="pending"]'),
      document.querySelector('[class*="unavailable"]'),
      document.querySelector('[class*="status-badge"]'),
      document.querySelector('[class*="sale-status"]'),
      document.querySelector('[class*="vehicle-status"]'),
    ]
    const statusBannerEl = bannerCandidates.find(function (el) { return el !== null }) ?? null
    const statusBannerText = statusBannerEl?.textContent?.trim() ?? ''

    return { specs, descriptionText, imageUrls, dealerPhone, dealerAddressText, statusBannerText }
  }, BASE_URL)
}
