-- Add migration-only CHECK constraints for numeric/range invariants (#1116).
--
-- Prisma cannot express CHECK constraints, so this migration is the source of
-- truth for these predicates — the same drift caveat as the partial-predicate
-- precedent in #1113 (see 20260820052054_add_listing_retention_applied_at).
-- schema.prisma carries comment pointers on each constrained model; the
-- column types there are unchanged on purpose so `prisma migrate diff`
-- reports no drift.
--
-- Predicates reject impossible values only, not business rules (e.g. price
-- may be 0 for POA listings; the app layer enforces tighter plausibility
-- such as 1990..currentYear+2 in listing-validator.ts):
--   money/counts/dimensions >= 0; year BETWEEN 1900 AND 2100;
--   lat BETWEEN -90 AND 90; lng BETWEEN -180 AND 180;
--   claim confidence BETWEEN 0 AND 1; dealer rating BETWEEN 0 AND 5;
--   star ratings (dealer review, NHTSA safety) BETWEEN 1 AND 5.
-- NULL values pass CHECKs, so nullable columns need no special handling.
--
-- Pre-migration audit on the dev database (2026-10-08, 7673 listings):
-- zero violating rows for every predicate below.
--
-- Each constraint is added NOT VALID then validated in the same migration:
-- the ADD takes only a brief lock, and VALIDATE rechecks existing rows
-- without blocking writes, so this stays safe as tables grow.

-- ── listings ─────────────────────────────────────────────────────────────
ALTER TABLE "listings" ADD CONSTRAINT "listings_priceCents_nonnegative" CHECK ("priceCents" >= 0) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_mileage_nonnegative" CHECK ("mileage" >= 0) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_year_range" CHECK ("year" BETWEEN 1900 AND 2100) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_lat_range" CHECK ("lat" BETWEEN -90 AND 90) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_lng_range" CHECK ("lng" BETWEEN -180 AND 180) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_wheelchairCapacity_nonnegative" CHECK ("wheelchairCapacity" >= 0) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_floorLoweringInches_nonnegative" CHECK ("floorLoweringInches" >= 0) NOT VALID;
ALTER TABLE "listings" ADD CONSTRAINT "listings_missingFromCompleteCount_nonnegative" CHECK ("missingFromCompleteCount" >= 0) NOT VALID;

-- ── listing_price_history / listing_mileage_history ──────────────────────
ALTER TABLE "listing_price_history" ADD CONSTRAINT "listing_price_history_priceCents_nonnegative" CHECK ("priceCents" >= 0) NOT VALID;
ALTER TABLE "listing_mileage_history" ADD CONSTRAINT "listing_mileage_history_mileage_nonnegative" CHECK ("mileage" >= 0) NOT VALID;

-- ── listing_field_claim ──────────────────────────────────────────────────
ALTER TABLE "listing_field_claim" ADD CONSTRAINT "listing_field_claim_confidence_range" CHECK ("confidence" BETWEEN 0 AND 1) NOT VALID;

-- ── vehicle / vehicle_models / vehicle_stats / vehicle_model_pricing ────
ALTER TABLE "vehicle" ADD CONSTRAINT "vehicle_year_range" CHECK ("year" BETWEEN 1900 AND 2100) NOT VALID;
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_year_range" CHECK ("year" BETWEEN 1900 AND 2100) NOT VALID;
ALTER TABLE "vehicle_stats" ADD CONSTRAINT "vehicle_stats_year_range" CHECK ("year" BETWEEN 1900 AND 2100) NOT VALID;
ALTER TABLE "vehicle_stats" ADD CONSTRAINT "vehicle_stats_avgLifespanMiles_nonnegative" CHECK ("avgLifespanMiles" >= 0) NOT VALID;
ALTER TABLE "vehicle_model_pricing" ADD CONSTRAINT "vehicle_model_pricing_originalMsrpCents_nonnegative" CHECK ("originalMsrpCents" >= 0) NOT VALID;
ALTER TABLE "vehicle_model_pricing" ADD CONSTRAINT "vehicle_model_pricing_destinationFeeCents_nonnegative" CHECK ("destinationFeeCents" >= 0) NOT VALID;

-- ── complaints / safety_ratings ──────────────────────────────────────────
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_mileage_nonnegative" CHECK ("mileage" >= 0) NOT VALID;
ALTER TABLE "safety_ratings" ADD CONSTRAINT "safety_ratings_overallRating_range" CHECK ("overallRating" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE "safety_ratings" ADD CONSTRAINT "safety_ratings_frontCrashRating_range" CHECK ("frontCrashRating" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE "safety_ratings" ADD CONSTRAINT "safety_ratings_sideCrashRating_range" CHECK ("sideCrashRating" BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE "safety_ratings" ADD CONSTRAINT "safety_ratings_rolloverRating_range" CHECK ("rolloverRating" BETWEEN 1 AND 5) NOT VALID;

-- ── conversion_products ──────────────────────────────────────────────────
ALTER TABLE "conversion_products" ADD CONSTRAINT "conversion_products_msrpCents_nonnegative" CHECK ("msrpCents" >= 0) NOT VALID;
ALTER TABLE "conversion_products" ADD CONSTRAINT "conversion_products_floorLoweringInches_nonnegative" CHECK ("floorLoweringInches" >= 0) NOT VALID;

-- ── nmea_dealers / dealer_profiles / dealer_reviews ──────────────────────
ALTER TABLE "nmea_dealers" ADD CONSTRAINT "nmea_dealers_lat_range" CHECK ("lat" BETWEEN -90 AND 90) NOT VALID;
ALTER TABLE "nmea_dealers" ADD CONSTRAINT "nmea_dealers_lng_range" CHECK ("lng" BETWEEN -180 AND 180) NOT VALID;
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_rating_range" CHECK ("rating" BETWEEN 0 AND 5) NOT VALID;
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_reviewCount_nonnegative" CHECK ("reviewCount" >= 0) NOT VALID;
ALTER TABLE "dealer_reviews" ADD CONSTRAINT "dealer_reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5) NOT VALID;

-- ── listing_image ────────────────────────────────────────────────────────
ALTER TABLE "listing_image" ADD CONSTRAINT "listing_image_position_nonnegative" CHECK ("position" >= 0) NOT VALID;
ALTER TABLE "listing_image" ADD CONSTRAINT "listing_image_widthPx_nonnegative" CHECK ("widthPx" >= 0) NOT VALID;
ALTER TABLE "listing_image" ADD CONSTRAINT "listing_image_heightPx_nonnegative" CHECK ("heightPx" >= 0) NOT VALID;

-- ── validate existing rows ───────────────────────────────────────────────
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_priceCents_nonnegative";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_mileage_nonnegative";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_year_range";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_lat_range";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_lng_range";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_wheelchairCapacity_nonnegative";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_floorLoweringInches_nonnegative";
ALTER TABLE "listings" VALIDATE CONSTRAINT "listings_missingFromCompleteCount_nonnegative";
ALTER TABLE "listing_price_history" VALIDATE CONSTRAINT "listing_price_history_priceCents_nonnegative";
ALTER TABLE "listing_mileage_history" VALIDATE CONSTRAINT "listing_mileage_history_mileage_nonnegative";
ALTER TABLE "listing_field_claim" VALIDATE CONSTRAINT "listing_field_claim_confidence_range";
ALTER TABLE "vehicle" VALIDATE CONSTRAINT "vehicle_year_range";
ALTER TABLE "vehicle_models" VALIDATE CONSTRAINT "vehicle_models_year_range";
ALTER TABLE "vehicle_stats" VALIDATE CONSTRAINT "vehicle_stats_year_range";
ALTER TABLE "vehicle_stats" VALIDATE CONSTRAINT "vehicle_stats_avgLifespanMiles_nonnegative";
ALTER TABLE "vehicle_model_pricing" VALIDATE CONSTRAINT "vehicle_model_pricing_originalMsrpCents_nonnegative";
ALTER TABLE "vehicle_model_pricing" VALIDATE CONSTRAINT "vehicle_model_pricing_destinationFeeCents_nonnegative";
ALTER TABLE "complaints" VALIDATE CONSTRAINT "complaints_mileage_nonnegative";
ALTER TABLE "safety_ratings" VALIDATE CONSTRAINT "safety_ratings_overallRating_range";
ALTER TABLE "safety_ratings" VALIDATE CONSTRAINT "safety_ratings_frontCrashRating_range";
ALTER TABLE "safety_ratings" VALIDATE CONSTRAINT "safety_ratings_sideCrashRating_range";
ALTER TABLE "safety_ratings" VALIDATE CONSTRAINT "safety_ratings_rolloverRating_range";
ALTER TABLE "conversion_products" VALIDATE CONSTRAINT "conversion_products_msrpCents_nonnegative";
ALTER TABLE "conversion_products" VALIDATE CONSTRAINT "conversion_products_floorLoweringInches_nonnegative";
ALTER TABLE "nmea_dealers" VALIDATE CONSTRAINT "nmea_dealers_lat_range";
ALTER TABLE "nmea_dealers" VALIDATE CONSTRAINT "nmea_dealers_lng_range";
ALTER TABLE "dealer_profiles" VALIDATE CONSTRAINT "dealer_profiles_rating_range";
ALTER TABLE "dealer_profiles" VALIDATE CONSTRAINT "dealer_profiles_reviewCount_nonnegative";
ALTER TABLE "dealer_reviews" VALIDATE CONSTRAINT "dealer_reviews_rating_range";
ALTER TABLE "listing_image" VALIDATE CONSTRAINT "listing_image_position_nonnegative";
ALTER TABLE "listing_image" VALIDATE CONSTRAINT "listing_image_widthPx_nonnegative";
ALTER TABLE "listing_image" VALIDATE CONSTRAINT "listing_image_heightPx_nonnegative";
