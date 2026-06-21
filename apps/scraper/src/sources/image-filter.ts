/**
 * Heuristics to reject non-vehicle images (logos, icons, staff photos, banners, etc.).
 * Runs inside page.evaluate() so must be a plain function with no external imports.
 */

// URL path segments that indicate site-chrome or non-vehicle imagery.
const NON_VEHICLE_PATH_PATTERNS =
  /\/(?:icon|logo|badge|banner|avatar|staff|team|person|social|sprite|header|footer|favicon|placeholder|tracking|pixel|spacer|arrow|bullet|star|rating|map|pin|marker)\b/i

// Minimum rendered or intrinsic size to be a vehicle photo (not an icon or thumbnail strip).
const MIN_WIDTH = 200
const MIN_HEIGHT = 150

export function isVehicleImageUrl(src: string): boolean {
  if (NON_VEHICLE_PATH_PATTERNS.test(src)) return false
  // Data URIs are always site-chrome (inline SVG icons, etc.)
  if (src.startsWith('data:')) return false
  return true
}

export function isVehicleImageElement(img: HTMLImageElement): boolean {
  if (!isVehicleImageUrl(img.getAttribute('data-src') ?? img.getAttribute('src') ?? '')) return false

  // Reject images that declare tiny explicit dimensions in HTML attributes.
  const attrW = parseInt(img.getAttribute('width') ?? '0', 10)
  const attrH = parseInt(img.getAttribute('height') ?? '0', 10)
  if (attrW > 0 && attrW < MIN_WIDTH) return false
  if (attrH > 0 && attrH < MIN_HEIGHT) return false

  // Reject images that have already rendered at tiny natural size.
  if (img.naturalWidth > 0 && img.naturalWidth < MIN_WIDTH) return false
  if (img.naturalHeight > 0 && img.naturalHeight < MIN_HEIGHT) return false

  return true
}
