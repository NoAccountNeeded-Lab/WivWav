/**
 * Eligibility + staleness scan for #798's semantic image-analysis queue.
 *
 * An image is in scope when it belongs to an active listing, is a real
 * vehicle photo (not a placeholder/site-chrome/excluded row), its cluster
 * (if any) isn't flagged as a reused/stock or cross-vehicle image per #503's
 * integrity analysis, and it has never been analyzed or was analyzed at an
 * older `semanticAnalysisVersion` than #796/#797's current taxonomy/prompt
 * version. Mirrors `photo-claim-provider.ts`'s `isImageEligibleForClaims`
 * eligibility rule, generalized here to a bulk scan (that function only
 * checks one `listingId`+`imageUrl` pair at a time).
 */

import type { PrismaClient } from '@wivwav/db'
import { CURRENT_SEMANTIC_ANALYSIS_VERSION } from './semantic-image-analysis.js'

export interface EligibleSemanticAnalysisImage {
  id: string
  listingId: string
  originalUrl: string
  normalizedUrl: string
}

export interface FindEligibleImagesOptions {
  sourceId?: string
  limit?: number
}

export async function findEligibleImagesForSemanticAnalysis(
  db: PrismaClient,
  options: FindEligibleImagesOptions = {},
): Promise<EligibleSemanticAnalysisImage[]> {
  const images = await db.listingImage.findMany({
    where: {
      kind: 'vehicle_photo',
      listing: {
        status: 'active',
        ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      },
      OR: [{ clusterId: null }, { cluster: { isPlaceholder: false, crossVehicle: false } }],
      AND: [
        {
          OR: [
            { semanticAnalysisVersion: null },
            { semanticAnalysisVersion: { lt: CURRENT_SEMANTIC_ANALYSIS_VERSION } },
          ],
        },
      ],
    },
    select: {
      id: true,
      listingId: true,
      originalUrl: true,
      normalizedUrl: true,
    },
    orderBy: { id: 'asc' },
    ...(options.limit !== undefined ? { take: options.limit } : {}),
  })

  return images
}
