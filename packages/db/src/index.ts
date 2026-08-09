export { getDb, disconnectDb } from './client.js'
export { PrismaClient, Prisma } from './generated/prisma/index.js'
export type {
  Listing,
  Source,
  ScraperRun,
  JobRun,
  ConfigEntry,
  ConfigEntryType,
  Vehicle,
  VehicleIdentityDecision,
  ListingImage,
  ImageCluster,
  ListingFieldClaim,
  ListingImageSemanticAnalysis,
  ListingReport,
  OpsProblemState,
} from './generated/prisma/index.js'
export {
  SourceStatus,
  WavFeature,
  ConversionStatus,
  ListingPublicationStatus,
  ListingReportType,
  ListingReportStatus,
  ImageKind,
  FieldResolutionState,
  OpsProblemSource,
  JobRunStatus,
} from './generated/prisma/index.js'
// vin.ts relocated to @wivwav/types (#950); re-exported for existing consumers.
export { normalizeVin, isValidVin, checkDigitValid } from '@wivwav/types'
export { findOrCreateVehicle } from './lib/vehicle-upsert.js'
export {
  upsertVehicleIdentityDecision,
  orderListingPair,
  findVehicleIdentityDecisionsByListing,
  findVehicleIdentityDecisionsByVehicle,
  VehicleIdentityDecisionState,
} from './lib/vehicle-identity-decision.js'
export type { VehicleIdentityDecisionInput } from './lib/vehicle-identity-decision.js'
export {
  upsertListingImage,
  upsertImageCluster,
  findListingImages,
  findImagesByExactHash,
  findPlaceholderClusters,
  findCrossVehicleClusters,
} from './lib/listing-image.js'
export type { ListingImageInput, ImageClusterInput } from './lib/listing-image.js'
export {
  appendScheduleIntent,
  appendSourceControlAuditEntry,
  readCurrentScheduleIntents,
  SCHEDULE_INTENT_KEY_PREFIX,
  SOURCE_CONTROL_AUDIT_KEY_PREFIX,
} from './lib/operator-intent.js'
export type { ScheduleIntent, SourceControlAuditEntry } from './lib/operator-intent.js'

// --- shared scraper-ingest persistence (#948/#951): one implementation used
// by apps/scraper's in-process jobs (until cutover) and apps/api's worker
// gateway. Relocated from apps/scraper; the scraper re-exports these.
export { isTransientPrismaError, withTransientRetry } from './lib/db-retry.js'
export { ingestListing } from './ingest/listing-ingest.js'
export type { ListingIngestTx } from './ingest/listing-ingest.js'
export { GONE_AFTER_CONSECUTIVE_MISSING, markGoneListings } from './ingest/mark-gone.js'
export type { MarkGoneListingsOptions } from './ingest/mark-gone.js'
export {
  DETAIL_EXTRACTION_VERSION,
  DETAIL_RESOLUTION_ENQUEUE_STAGE,
  auditDetailValue,
  buildListingDetailUpdateData,
  changedDetailFields,
  detailObservationReference,
  enqueueRequiredListingResolution,
  requiresListingResolution,
  resolveListingStatus,
} from './ingest/detail-apply.js'
export type {
  DetailApplyResult,
  DetailEnrichment,
  DetailEvidence,
  ResolutionEnqueueQueue,
  StatusUpdate,
} from './ingest/detail-apply.js'
export { MIN_PHOTO_CONFIDENCE, resolveField, resolveFields } from './resolution/resolver.js'
export type {
  ClaimField,
  EvidenceKind,
  FieldClaim,
  NewFieldClaim,
  ResolvedField,
} from './resolution/types.js'
export {
  NoopPhotoClaimProvider,
  isImageEligibleForClaims,
} from './resolution/photo-claim-provider.js'
export type { PhotoClaimProvider } from './resolution/photo-claim-provider.js'
export { buildFieldUpdateData } from './resolution/listing-update.js'
export { logFieldResolutionEvent } from './resolution/metrics.js'
export {
  applyFieldResolution,
  getClaimsForListing,
  recordClaim,
  resolveListingField,
} from './resolution/claims-repository.js'
export type {
  ClaimsTx,
  FieldResolutionLogEvent,
  FieldResolutionResult,
} from './resolution/claims-repository.js'
export { CARD_CLAIM_EXTRACTOR_VERSION, recordCardFieldClaims } from './resolution/card-claims.js'
export { recordDetailFieldClaims } from './resolution/detail-claims.js'
export { isRecordNotFoundError } from './lib/prisma-errors.js'
export { startScraperRun, completeScraperRun, failScraperRun } from './ingest/scraper-run-state.js'
export type { ScraperRunRecord } from './ingest/scraper-run-state.js'
export {
  getSourceExecutionState,
  getSourceDriftBaseline,
  getSourceLastFullCrawlAt,
  getSourceMappings,
  markSourceActive,
  markSourceChecked,
  markSourceError,
  markSourceNeedsRemapping,
  markSourcePaused,
  setSourceDriftBaseline,
  setSourceMappings,
} from './ingest/source-state.js'
export type { SourceDriftBaseline, SourceExecutionState } from './ingest/source-state.js'
