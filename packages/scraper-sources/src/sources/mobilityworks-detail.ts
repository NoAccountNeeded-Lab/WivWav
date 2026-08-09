import type { BrowserPage } from '../browser/index.js'
import type { ConversionType, RampType, SaleStatus, WavFeature } from '@wivwav/types'
import { parseSaleStatus } from '../lib/sale-status.js'

const BASE_URL = 'https://www.mobilityworks.com'

export interface RawMwDetail {
  specs: Record<string, string>
  /**
   * Vehicle-specific description text. Only populated when the scraper
   * successfully located the vehicle description section on the page.
   * An empty string here means the section was absent, not that the
   * extraction logic failed on content.
   */
  descriptionText: string
  /**
   * True when the scraper successfully located and bounded the vehicle
   * description container. False means the section was absent or did
   * not match any known selector — never a page-wide fallback.
   */
  descriptionFound: boolean
  imageUrls: string[]
  /**
   * True when the scraper successfully located a vehicle-specific gallery
   * container. False means no gallery container was identified — the image
   * list will be empty rather than a polluted page-wide collection.
   */
  galleryFound: boolean
  dealerPhone: string
  dealerAddressText: string
  statusBannerText: string
}

export interface MwDetailFields {
  color: string | null
  /**
   * Fuel type from an explicit "Fuel Type" spec key only.
   * Engine displacement/configuration is NOT written here.
   */
  fuelType: string | null
  transmission: string | null
  rampType: RampType
  /**
   * Entry-direction claim parsed from the vehicle-specific detail
   * description text. Independent of any card/category-derived value — the
   * #499 resolver reconciles the two rather than one overwriting the other.
   * `unknown` means the detail text made no identifiable entry-type claim.
   */
  conversionType: ConversionType
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

/**
 * Parses an entry-direction claim from vehicle-specific detail description
 * text. Mirrors mobilityworks.ts's card-level `parseConversionType`, applied
 * to a different evidence source — the #499 resolver decides whether the two
 * agree. `unknown` means no identifiable claim, not a positive assertion.
 */
export function parseMwDetailConversionType(text: string): ConversionType {
  const t = text.toLowerCase()
  if (t.includes('rear entry') || t.includes('rear-entry')) return 'rear_entry'
  if (t.includes('side entry') || t.includes('side-entry')) return 'side_entry'
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

  // Only use description when the vehicle description container was found.
  // An extraction failure (descriptionFound: false) is not the same as a
  // vehicle that genuinely has no description — treat both as null so we
  // don't overwrite a previously valid observation with empty content.
  const desc = raw.descriptionFound ? raw.descriptionText : ''
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
    // "Fuel Type" spec key only — Engine displacement/type is NOT fuel type.
    fuelType: spec('Fuel Type'),
    transmission: spec('Transmission'),
    rampType: parseMwRampType(desc),
    conversionType: parseMwDetailConversionType(desc),
    wavFeatures,
    floorLoweringInches: parseMwFloorLowering(desc),
    wheelchairCapacity: null,
    // null when the description section was absent or extraction failed.
    description: desc || null,
    // Only pass through images when the gallery container was found; an
    // empty list is preferable to a list of site chrome and badge images.
    images: raw.galleryFound ? raw.imageUrls : [],
    zip: parseMwZip(raw.dealerAddressText),
    dealerPhone: raw.dealerPhone || null,
    saleStatus: parseSaleStatus(raw.statusBannerText),
  }
}

/**
 * URL path patterns for non-vehicle images.
 * Covers MobilityWorks CDN paths for site chrome, social icons, brand logos,
 * financing badges, conversion badges, arrows, and UI decorations.
 *
 * NOTE: This constant is intentionally duplicated inside page.evaluate() below.
 * Changes here must be mirrored there; the browser sandbox has no module access.
 */
export const NON_VEHICLE_PATH_PATTERN =
  /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker|brand|promo|partner|financing|certified|nmeda|braun|vmi|ally|converted|conversion)\b/i

export async function evaluateMwDetail(page: BrowserPage): Promise<RawMwDetail> {
  return page.evaluate(function (baseUrl: string): RawMwDetail {
    // ── Specs ───────────────────────────────────────────────────────────────
    // MobilityWorks uses spec-row divs with label/value spans, definition lists,
    // and occasionally table rows. Try all three; first to yield wins.
    const specs: Record<string, string> = {}

    // Spec-row pattern: .spec-row > .spec-label + .spec-value (or similar)
    document.querySelectorAll('[class*="spec-row"], [class*="spec_row"]').forEach(function (row) {
      const label = row.querySelector('[class*="spec-label"], [class*="spec_label"], dt')?.textContent?.trim()
      const value = row.querySelector('[class*="spec-value"], [class*="spec_value"], dd')?.textContent?.trim()
      if (label && value) specs[label] = value
    })

    // Definition list (dl > dt + dd) if spec-rows didn't yield results
    if (Object.keys(specs).length === 0) {
      document.querySelectorAll('dl').forEach(function (dl) {
        const dts = Array.from(dl.querySelectorAll('dt'))
        const dds = Array.from(dl.querySelectorAll('dd'))
        dts.forEach(function (dt, i) {
          const label = dt.textContent?.trim()
          const value = dds[i]?.textContent?.trim()
          if (label && value) specs[label] = value
        })
      })
    }

    // Table row fallback
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

    // ── Description ─────────────────────────────────────────────────────────
    // Only extract from a bounded vehicle description container. Do NOT fall
    // back to arbitrary page paragraphs — that harvests financing disclaimers,
    // about-us copy, and navigation text as if they were vehicle descriptions.
    let descriptionText = ''
    let descriptionFound = false

    // Strategy 1: section/div with a class name that names the description area
    const descContainer = document.querySelector<HTMLElement>(
      '[class*="vehicle-description"], [class*="vehicle_description"], [class*="mw-description"], [class*="description-section"]',
    )
    if (descContainer) {
      const p = descContainer.querySelector('p')
      if (p?.textContent && p.textContent.trim().length > 0) {
        descriptionText = p.textContent.trim()
        descriptionFound = true
      } else if (descContainer.textContent && descContainer.textContent.trim().length > 0) {
        // Container itself may hold text directly
        const containerText = descContainer.textContent.trim()
        if (containerText.length > 20) {
          descriptionText = containerText
          descriptionFound = true
        }
      }
    }

    // Strategy 2: walk up from a heading that names the description section
    if (!descriptionFound) {
      const descHeading = Array.from(document.querySelectorAll('h2, h3')).find(function (h) {
        return /vehicle\s+description|vehicle\s+details|about\s+this\s+vehicle/i.test(h.textContent ?? '')
      })
      if (descHeading) {
        // Sibling paragraph search — look at immediate following siblings first
        let sibling: Element | null = descHeading.nextElementSibling
        while (sibling) {
          if (sibling.tagName === 'P' && (sibling.textContent?.trim().length ?? 0) > 20) {
            descriptionText = sibling.textContent!.trim()
            descriptionFound = true
            break
          }
          // Stop if we hit another heading (out of scope)
          if (/^H[1-6]$/.test(sibling.tagName)) break
          sibling = sibling.nextElementSibling
        }

        // If no sibling paragraph, look in the parent container
        if (!descriptionFound) {
          let node: Element | null = descHeading
          while (node?.parentElement && node.parentElement !== document.body) {
            node = node.parentElement
            const p = node.querySelector('p')
            if (p?.textContent && p.textContent.trim().length > 20) {
              descriptionText = p.textContent.trim()
              descriptionFound = true
              break
            }
          }
        }
      }
    }

    // ── Gallery ─────────────────────────────────────────────────────────────
    // Only collect images from a verified vehicle gallery container.
    // Do NOT fall back to main, article, or document.body — those containers
    // include site chrome, financing badges, social icons, and brand logos.
    const NON_VEHICLE_PATH =
      /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker|brand|promo|partner|financing|certified|nmeda|braun|vmi|ally|converted|conversion)\b/i
    const MIN_W = 200
    const MIN_H = 150

    const seen = new Set<string>()
    const imageUrls: string[] = []

    function collectImage(img: HTMLImageElement): void {
      // MobilityWorks serves lazy-loaded images through its Nitro caching
      // plugin, which stores the real URL in `nitro-lazy-src` and leaves
      // `src` as a base64 placeholder SVG until the element scrolls into
      // view. Check the lazy-load attributes before falling back to `src`.
      const src =
        img.getAttribute('data-src') ??
        img.getAttribute('nitro-lazy-src') ??
        img.getAttribute('data-lazy-src') ??
        img.getAttribute('data-original') ??
        img.getAttribute('src') ??
        ''
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
    }

    // Strategy 1: MobilityWorks' own vehicle-detail slider — a main image
    // (#mainimagetarget) plus a thumbnail strip (#vehimage-0, #vehimage-1, …).
    // These ids are specific to vehicle photos, so no container-class match
    // is needed to avoid picking up promo banners elsewhere on the page.
    const mwSlideImages = document.querySelectorAll<HTMLImageElement>(
      '#mainimagetarget, [id^="vehimage-"]',
    )
    let galleryFound = mwSlideImages.length > 0
    mwSlideImages.forEach(collectImage)

    // Strategy 2: generic vehicle gallery container, for other MobilityWorks
    // page templates/redesigns that don't use the vehimage id convention.
    if (!galleryFound) {
      const galleryRoot = document.querySelector<HTMLElement>(
        '[class*="vehicle-gallery"], [class*="vehicle_gallery"], [class*="mw-gallery"], [class*="photo-gallery"], [id*="vehicle-gallery"], [id*="vehicleGallery"], [class*="image-slider"], [class*="imageSlider"], [class*="photo-slider"], [class*="vehimageshold"], [class*="vehthumb"], [id*="thumbholder"]',
      )
      galleryFound = galleryRoot !== null
      if (galleryRoot) {
        galleryRoot.querySelectorAll<HTMLImageElement>('img').forEach(collectImage)
      }
    }

    // ── Dealer contact ───────────────────────────────────────────────────────
    const phoneEl = document.querySelector<HTMLAnchorElement>('a[href^="tel:"]')
    const dealerPhone = phoneEl?.textContent?.trim() ?? ''

    const addressEl = document.querySelector<HTMLElement>(
      'address, [class*="dealer-address"], [class*="dealer_address"], [class*="location-address"]',
    )
    const dealerAddressText = addressEl?.innerText?.replace(/\s+/g, ' ').trim() ?? ''

    // ── Sale status ──────────────────────────────────────────────────────────
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

    return { specs, descriptionText, descriptionFound, imageUrls, galleryFound, dealerPhone, dealerAddressText, statusBannerText }
  }, BASE_URL)
}
