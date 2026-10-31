\pset pager off
select count(*) vehicles, count(*) filter (where n=1) one_listing from (select v.id, count(l.id) n from vehicle v left join listings l on l."vehicleId"=v.id group by 1) x;
select count(*) from raw_pages; select count(*) filter (where "processedAt" is null) unprocessed from raw_pages;
select "jobType",status,count(*) from job_run where "startedAt" > now()-interval '10 days' and status='running' group by 1,2;
select count(*) from listings where "publicationStatus"='pending' and "detailScrapedAt" is not null and "qualityCheckedAt" is null;
