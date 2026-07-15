export { getDb, disconnectDb } from './client.js'
export { PrismaClient, Prisma } from './generated/prisma/index.js'
export type {
  Listing,
  Source,
  ScraperRun,
  ConfigEntry,
  ConfigEntryType,
  Vehicle,
  VehicleIdentityDecision,
  ListingImage,
  ImageCluster,
  ListingFieldClaim,
  ListingReport,
} from './generated/prisma/index.js'
export { SourceStatus, WavFeature, ConversionStatus, ListingPublicationStatus, ListingReportType, ListingReportStatus, ImageKind, FieldResolutionState } from './generated/prisma/index.js'
export { normalizeVin, isValidVin, checkDigitValid } from './lib/vin.js'
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
