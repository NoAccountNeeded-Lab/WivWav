\pset pager off
select count(*) li_rows, count(distinct "listingId") li_listings from listing_image;
select count(*) sem, count(distinct "listingId") l from listing_image_semantic_analysis;
select count(*) fc, count(distinct "listingId") l from listing_field_claim;
select count(*) from vehicle; select count(*) from dealer_profiles; select count(*) from vehicle_model_research;
with e as (select * from listings where status='active' and "publicationStatus"='eligible')
select
 count(*) filter (where "detailScrapedAt" is not null) detail_done,
 count(*) filter (where "detailScrapedAt" is not null and lat is not null and vin is not null and "vehicleId" is not null and "vehicleModelId" is not null and array_length(images,1)>1 and "conversionType"<>'unknown') all_markers_strict,
 count(*) filter (where "detailScrapedAt" is not null and (lat is not null) and ("vehicleModelId" is not null) and array_length(images,1)>=1 and "conversionType"<>'unknown') relaxed_no_vin,
 count(*) filter (where lat is not null and "vehicleModelId" is not null) geo_and_model,
 count(*) filter (where lat is null and zip is null) no_lat_no_zip,
 count(*) filter (where lat is null and zip is not null) no_lat_has_zip,
 count(*) filter (where vin is not null and "vehicleId" is null) vin_not_linked,
 count(*) filter (where "vehicleModelId" is not null) has_model,
 count(*) filter (where "scrapedAt" > now()-interval '2 days') fresh2d
from e;
select s.name, l.status, l."publicationStatus", count(*) filter (where "detailScrapedAt" is null) no_detail, count(*) from listings l join sources s on s.id=l."sourceId" group by 1,2,3 order by 1,2,3;
select "vehicleModelMatchConfidence", count(*) from listings where status='active' and "publicationStatus"='eligible' group by 1;
select count(*) filter (where "lat" is not null) geocoded, count(*) filter (where "detailScrapedAt" is not null) det from listings where "publicationStatus"='pending';
select count(*) from listings l where l.status='active' and l."publicationStatus"='eligible' and l.zip is null and l.lat is null;
