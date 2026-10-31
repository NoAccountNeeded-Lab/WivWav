\pset pager off
select "jobType", status, count(*), min("startedAt")::date first, max("startedAt")::date last from job_run group by 1,2 order by 1,2;
select stage, count(*), count(distinct "listingId") listings, min("observedAt")::date, max("observedAt")::date from listing_observation group by 1;
select count(*) from scraper_runs;
\d vehicles
select "conversionTypeResolution", count(*) from listings where status='active' and "publicationStatus"='eligible' group by 1;
select count(*) li_rows, count(distinct "listingId") li_listings from listing_images;
select count(*) sem from listing_image_semantic_analyses;
select count(*) fc, count(distinct "listingId") from listing_field_claims;
select count(*) from dealer_profiles; select count(*) from vehicle_models; select count(*) from vehicle_stats; select count(*) from recalls;
