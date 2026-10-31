\pset pager off
select count(*) filter (where lat is null and (city is null or city='' or state is null or state='')) lat_null_no_city_state,
 count(*) filter (where lat is null and city is not null and state is not null) lat_null_geocodable
from listings where status='active' and "publicationStatus"='eligible';
select count(*) filter (where "detailScrapedAt" is null and "cardImages" is not null) c from listings where status='active' and "publicationStatus"='eligible';
select count(*) filter (where array_length(images,1) is null) no_img, count(*) filter (where array_length(images,1)=1) one from listings where status='active' and "publicationStatus"='eligible' and "detailScrapedAt" is null;
select count(*) from listings l where status='active' and "publicationStatus"='eligible' and exists(select 1 from listing_observation o where o."listingId"=l.id and o.stage='detail');
select count(*) filter(where vin is not null and length(vin)=17) v17, count(*) filter (where vin is not null and length(vin)<>17) vbad from listings where status='active' and "publicationStatus"='eligible';
select count(*) from listings where "lastRunId" is not null;
select s.name, s.status, s."cronExpression" from sources s order by 1;
select count(*) filter (where "scrapedAt" < now()-interval '3 days') stale_3d, max("scrapedAt") from listings where status='active';
select count(*) from listings l where status='active' and "publicationStatus"='eligible' and "qualityCheckedAt" < (select min("startedAt") from job_run where "jobType"='listing-resolve');
