import type { PrismaClient } from '../generated/prisma/index.js'
import type { ClaimField, NewFieldClaim } from './types.js'

/**
 * Provider-neutral source of photo-derived claims for one listing/field.
 * #129 owns image analysis, labeling, and model/provider execution; this
 * interface is the seam #499 defines so the resolver can consume trustworthy
 * photo evidence without depending on #129's implementation or provider
 * choice. Until a real classifier lands, production wiring uses
 * `NoopPhotoClaimProvider`; tests inject a stub to exercise photo-claim
 * conflict/agreement resolution ahead of #129 (per the issue's acceptance
 * criteria).
 */
export interface PhotoClaimProvider {
  getClaims(listingId: string, field: ClaimField): Promise<NewFieldClaim[]>
}

/** Default provider: no photo-derived claims. Safe until #129 supplies a real one. */
export class NoopPhotoClaimProvider implements PhotoClaimProvider {
  async getClaims(): Promise<NewFieldClaim[]> {
    return []
  }
}

/**
 * Reused/stock-photo eligibility check backed by #129's existing image
 * pipeline (`ListingImage`/`ImageCluster`, see packages/db/prisma/schema.prisma).
 * A real PhotoClaimProvider (once #129 ships entry/ramp-type classification)
 * should call this before emitting a claim for a given image URL — this
 * function does not itself classify entry/ramp type, it only says whether an
 * image is reused/stock and therefore ineligible to establish or override a
 * value, per the issue's resolution policy.
 */
export async function isImageEligibleForClaims(
  db: PrismaClient,
  listingId: string,
  imageUrl: string,
): Promise<{ eligible: boolean; reason: string | null }> {
  const image = await db.listingImage.findFirst({
    where: { listingId, originalUrl: imageUrl },
    select: {
      cluster: {
        select: { isPlaceholder: true, crossVehicle: true, reasonCode: true },
      },
    },
  })
  if (!image?.cluster) return { eligible: true, reason: null }
  if (image.cluster.isPlaceholder || image.cluster.crossVehicle) {
    return {
      eligible: false,
      reason: image.cluster.reasonCode ?? 'reused/stock image cluster',
    }
  }
  return { eligible: true, reason: null }
}
