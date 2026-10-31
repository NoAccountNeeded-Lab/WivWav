\pset pager off
select status, "publicationStatus", count(*) from listings group by 1,2 order by 1,2;
select count(*) total_ae, 
 count(*) filter (where "detailScrapedAt" is null) no_detail,
 count(*) filter (where lat is null) no_lat,
 count(*) filter (where vin is null) no_vin,
 count(*) filter (where "vehicleId" is null) no_vehicleId,
 count(*) filter (where "vehicleModelId" is null) no_model,
 count(*) filter (where coalesce(array_length(images,1),0)=0) no_img,
 count(*) filter (where coalesce(array_length(images,1),0)=1) one_img,
 count(*) filter (where "conversionType"='unknown') conv_unknown,
 count(*) filter (where "rampType"='unknown') ramp_unknown,
 count(*) filter (where "qualityCheckedAt" is null) no_qc,
 count(*) filter (where "dealerProfileId" is null) no_dealer,
 count(*) filter (where "lastRunId" is null) no_lastrun,
 count(*) filter (where "isDuplicate") dup
from listings where status='active' and "publicationStatus"='eligible';
