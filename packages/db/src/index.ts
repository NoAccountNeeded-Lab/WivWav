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
} from './generated/prisma/index.js'
export { WavFeature, ConversionStatus, ListingPublicationStatus } from './generated/prisma/index.js'
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
