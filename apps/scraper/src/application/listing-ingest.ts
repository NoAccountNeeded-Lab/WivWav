import type { Prisma } from '@wivwav/db'
import type { ListingUpsertData, ListingUpsertResult } from '../engine/repositories.js'

/**
 * Single-owner listing-ingest application service. Owns upsert-by-
 * `sourceRecordKey`, price/mileage/conversion history-row writes on value
 * change, and idempotency (refs #671; supersedes #451's API-route approach
 * per #666 D2 — workers are co-located, so no HTTP indirection is needed).
 *
 * Takes the already-open Prisma transaction client: `prisma-repositories.ts`
 * owns opening the transaction (with retry) and passes its `tx` here — it
 * must not duplicate any of this diffing/write logic itself.
 *
 * Deliberate exception to core.md's "keep swappable dependencies behind
 * interfaces": this service has one owner and one implementation (Prisma),
 * so `ListingIngestTx` aliases Prisma's own transaction-client type rather
 * than a hand-rolled port. Revisit only if a second persistence adapter is
 * ever justified.
 */
export type ListingIngestTx = Prisma.TransactionClient

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false

  const normalizedLeft = [...left].sort()
  const normalizedRight = [...right].sort()
  return normalizedLeft.every((value, index) => value === normalizedRight[index])
}

function sameObservedValue(left: unknown, right: unknown): boolean {
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime()
  if (Array.isArray(left) && Array.isArray(right)) return sameStringSet(left, right)
  return left === right
}

function sourceObservation(listing: ListingUpsertData, buyerUrl: string | null) {
  return {
    sourceUrl: listing.sourceUrl,
    buyerUrl,
    externalId: listing.externalId,
    stockNumber: listing.stockNumber,
    make: listing.make,
    model: listing.model,
    year: listing.year,
    trim: listing.trim,
    vin: listing.vin,
    condition: listing.condition,
    sellerType: listing.sellerType,
    priceCents: listing.priceCents,
    mileage: listing.mileage,
    color: listing.color,
    conversionType: listing.wav.conversionType,
    conversionManufacturer: listing.wav.conversionManufacturer,
    floorLoweringInches: listing.wav.floorLoweringInches,
    rampType: listing.wav.rampType,
    conversionStatus: listing.wav.conversionStatus,
    wavFeatures: listing.wav.wavFeatures,
    wheelchairCapacity: listing.wav.wheelchairCapacity,
    zip: listing.location.zip,
    city: listing.location.city,
    state: listing.location.state,
    dealerName: listing.dealer.name,
    cardImages: listing.images,
    ...(listing.sourceListedAt != null ? { sourceListedAt: listing.sourceListedAt } : {}),
    ...(listing.sourceUpdatedAt != null ? { sourceUpdatedAt: listing.sourceUpdatedAt } : {}),
    qualityIssueCodes: listing.qualityIssueCodes ?? [],
    status: 'active',
  }
}

/**
 * Upserts a scraped listing by `sourceRecordKey`, writing price/mileage/
 * conversion history rows only when the relevant value actually changed, and
 * recording a `listingObservation` audit row for every create/update. Returns
 * `outcome: 'unchanged'` (writing nothing) when a re-ingest observes no diff,
 * so repeated ingests of the same payload are idempotent and never duplicate
 * history rows.
 */
export async function ingestListing(tx: ListingIngestTx, listing: ListingUpsertData): Promise<ListingUpsertResult> {
  const existing = await tx.listing.findUnique({
    where: {
      sourceId_sourceRecordKey: {
        sourceId: listing.sourceId,
        sourceRecordKey: listing.sourceRecordKey,
      },
    },
    select: {
      id: true,
      sourceUrl: true,
      buyerUrl: true,
      externalId: true,
      stockNumber: true,
      make: true,
      model: true,
      year: true,
      trim: true,
      vin: true,
      condition: true,
      sellerType: true,
      priceCents: true,
      mileage: true,
      color: true,
      conversionType: true,
      conversionManufacturer: true,
      floorLoweringInches: true,
      rampType: true,
      conversionStatus: true,
      wavFeatures: true,
      wheelchairCapacity: true,
      zip: true,
      city: true,
      state: true,
      dealerName: true,
      cardImages: true,
      sourceListedAt: true,
      sourceUpdatedAt: true,
      qualityIssueCodes: true,
      status: true,
    },
  })

  const buyerUrl =
    existing?.buyerUrl && existing.buyerUrl !== existing.sourceUrl && listing.buyerUrl === listing.sourceUrl
      ? existing.buyerUrl
      : listing.buyerUrl
  const after = sourceObservation(listing, buyerUrl)

  if (existing !== null) {
    // A card-level payload with color: null means the source's listing card
    // doesn't expose color (e.g. BLVD, which only surfaces it on the detail
    // page) — not that the vehicle has no color. Without this, a routine
    // card recrawl silently regresses a detail-extracted color back to null
    // before it can ever be validated as eligible (refs #629).
    after.color = listing.color ?? existing.color

    // Current card adapters use these values when the card exposes no
    // accessibility evidence. Preserve a detail/resolution-owned value for
    // those absence sentinels; a real card value still replaces the current
    // value and is recorded below for resolution (fixes #633).
    after.rampType = listing.wav.rampType === 'unknown'
      ? existing.rampType
      : listing.wav.rampType
    after.wavFeatures = listing.wav.wavFeatures.length === 0
      ? existing.wavFeatures
      : listing.wav.wavFeatures
    after.floorLoweringInches = listing.wav.floorLoweringInches
      ?? existing.floorLoweringInches
    after.wheelchairCapacity = listing.wav.wheelchairCapacity
      ?? existing.wheelchairCapacity
  }

  if (existing === null) {
    const created = await tx.listing.create({ data: {
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl,
      buyerUrl: listing.buyerUrl,
      externalId: listing.externalId,
      stockNumber: listing.stockNumber,
      sourceRecordKey: listing.sourceRecordKey,
      make: listing.make,
      model: listing.model,
      year: listing.year,
      trim: listing.trim,
      vin: listing.vin,
      condition: listing.condition,
      sellerType: listing.sellerType,
      priceCents: listing.priceCents,
      mileage: listing.mileage,
      color: listing.color,
      fuelType: listing.fuelType,
      transmission: listing.transmission,
      conversionType: listing.wav.conversionType,
      conversionManufacturer: listing.wav.conversionManufacturer,
      floorLoweringInches: listing.wav.floorLoweringInches,
      rampType: listing.wav.rampType,
      conversionStatus: listing.wav.conversionStatus,
      wavFeatures: listing.wav.wavFeatures,
      wheelchairCapacity: listing.wav.wheelchairCapacity,
      zip: listing.location.zip,
      city: listing.location.city,
      state: listing.location.state,
      lat: listing.location.lat,
      lng: listing.location.lng,
      dealerName: listing.dealer.name,
      dealerPhone: listing.dealer.phone,
      dealerWebsite: listing.dealer.website,
      cardImages: listing.images,
      images: listing.images,
      description: listing.description,
      qualityIssueCodes: listing.qualityIssueCodes ?? [],
      publicationStatus: listing.publicationStatus ?? 'pending',
      qualityCheckedAt: listing.qualityCheckedAt ?? null,
      listedAt: listing.listedAt,
      sourceListedAt: listing.sourceListedAt ?? null,
      sourceUpdatedAt: listing.sourceUpdatedAt ?? null,
      lastRunId: listing.runId ?? null,
    } })
    if (listing.priceCents != null) {
      await tx.listingPriceHistory.create({
        data: { listingId: created.id, priceCents: listing.priceCents },
      })
    }
    if (listing.mileage != null) {
      await tx.listingMileageHistory.create({
        data: { listingId: created.id, mileage: listing.mileage },
      })
    }
    await tx.listingConversionHistory.create({
      data: {
        listingId: created.id,
        conversionStatus: listing.wav.conversionStatus,
        wavFeatures: listing.wav.wavFeatures,
      },
    })
    await tx.listingObservation.create({
      data: {
        listingId: created.id,
        stage: 'list_card',
        extractionVersion: 'source-card-v1',
        changedFields: Object.keys(after),
        before: {},
        after,
      },
    })
    return { listingId: created.id, outcome: 'created', changedFields: Object.keys(after) }
  }

  const before = {
    sourceUrl: existing.sourceUrl,
    buyerUrl: existing.buyerUrl,
    externalId: existing.externalId,
    stockNumber: existing.stockNumber,
    make: existing.make,
    model: existing.model,
    year: existing.year,
    trim: existing.trim,
    vin: existing.vin,
    condition: existing.condition,
    sellerType: existing.sellerType,
    priceCents: existing.priceCents,
    mileage: existing.mileage,
    color: existing.color,
    conversionType: existing.conversionType,
    conversionManufacturer: existing.conversionManufacturer,
    floorLoweringInches: existing.floorLoweringInches,
    rampType: existing.rampType,
    conversionStatus: existing.conversionStatus,
    wavFeatures: existing.wavFeatures,
    wheelchairCapacity: existing.wheelchairCapacity,
    zip: existing.zip,
    city: existing.city,
    state: existing.state,
    dealerName: existing.dealerName,
    cardImages: existing.cardImages,
    sourceListedAt: existing.sourceListedAt,
    sourceUpdatedAt: existing.sourceUpdatedAt,
    qualityIssueCodes: existing.qualityIssueCodes,
    status: existing.status,
  }
  const changedFields = Object.keys(after).filter((field) => {
    const previous = before[field as keyof typeof before]
    const next = after[field as keyof typeof after]
    return !sameObservedValue(previous, next)
  })
  const cameBack = existing.status === 'gone' || existing.status === 'possibly_gone'

  if (changedFields.length === 0) {
    return { listingId: existing.id, outcome: 'unchanged', changedFields: [] }
  }

  const priceChanged = changedFields.includes('priceCents')
  const mileageChanged = changedFields.includes('mileage')
  const conversionChanged = changedFields.some((field) => [
    'conversionType',
    'conversionManufacturer',
    'floorLoweringInches',
    'rampType',
    'conversionStatus',
    'wavFeatures',
    'wheelchairCapacity',
  ].includes(field))
  const locationChanged = changedFields.some((field) => ['zip', 'city', 'state'].includes(field))
  const resetDetail = changedFields.some(
    (field) => ![
      'buyerUrl',
      'sellerType',
      'sourceListedAt',
      'sourceUpdatedAt',
      'qualityIssueCodes',
    ].includes(field),
  )

  await tx.listing.update({
    where: { id: existing.id },
    data: {
      sourceUrl: listing.sourceUrl,
      buyerUrl,
      externalId: listing.externalId,
      stockNumber: listing.stockNumber,
      make: listing.make,
      model: listing.model,
      year: listing.year,
      trim: listing.trim,
      vin: listing.vin,
      condition: listing.condition,
      sellerType: listing.sellerType,
      priceCents: listing.priceCents,
      mileage: listing.mileage,
      color: after.color,
      conversionType: listing.wav.conversionType,
      conversionManufacturer: listing.wav.conversionManufacturer,
      floorLoweringInches: after.floorLoweringInches,
      rampType: after.rampType,
      conversionStatus: listing.wav.conversionStatus,
      wavFeatures: after.wavFeatures,
      wheelchairCapacity: after.wheelchairCapacity,
      zip: listing.location.zip,
      city: listing.location.city,
      state: listing.location.state,
      ...(locationChanged ? { lat: null, lng: null } : {}),
      dealerName: listing.dealer.name,
      cardImages: listing.images,
      ...(listing.sourceListedAt != null ? { sourceListedAt: listing.sourceListedAt } : {}),
      ...(listing.sourceUpdatedAt != null ? { sourceUpdatedAt: listing.sourceUpdatedAt } : {}),
      scrapedAt: new Date(),
      status: 'active',
      goneAt: null,
      publicationStatus: listing.publicationStatus ?? 'pending',
      qualityIssueCodes: listing.qualityIssueCodes ?? [],
      qualityCheckedAt: listing.qualityCheckedAt ?? null,
      ...(resetDetail ? { detailScrapedAt: null } : {}),
      ...(cameBack ? { saleStatus: 'active', soldAt: null } : {}),
      ...(listing.runId != null ? { lastRunId: listing.runId } : {}),
    },
  })

  if (priceChanged && listing.priceCents != null) {
    await tx.listingPriceHistory.create({
      data: { listingId: existing.id, priceCents: listing.priceCents },
    })
  }

  if (mileageChanged && listing.mileage != null) {
    await tx.listingMileageHistory.create({
      data: { listingId: existing.id, mileage: listing.mileage },
    })
  }

  if (conversionChanged) {
    await tx.listingConversionHistory.create({
      data: {
        listingId: existing.id,
        conversionStatus: listing.wav.conversionStatus,
        wavFeatures: after.wavFeatures,
      },
    })
  }

  await tx.listingObservation.create({
    data: {
      listingId: existing.id,
      stage: 'list_card',
      extractionVersion: 'source-card-v1',
      changedFields,
      before,
      after,
    },
  })
  return { listingId: existing.id, outcome: 'updated', changedFields }
}
