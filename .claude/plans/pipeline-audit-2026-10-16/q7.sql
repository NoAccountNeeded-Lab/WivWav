\pset pager off
with e as (select * from listings where status='active' and "publicationStatus"='eligible')
select
 count(*) filter (where "detailScrapedAt" is not null and lat is not null and "vehicleModelId" is not null and coalesce(array_length(images,1),0)>1 and "conversionType"<>'unknown') A_all_five,
 count(*) filter (where "detailScrapedAt" is not null) s1_detail,
 count(*) filter (where "detailScrapedAt" is not null and (lat is not null or city is null or state is null)) s1_2,
 count(*) filter (where "detailScrapedAt" is not null and (lat is not null or city is null or state is null) and (vin is null or "vehicleModelId" is not null)) s1_3,
 count(*) filter (where "detailScrapedAt" is not null and (lat is not null or city is null or state is null) and (vin is null or "vehicleModelId" is not null) and coalesce(array_length(images,1),0)>=1) s1_4,
 count(*) filter (where "detailScrapedAt" is not null and (lat is not null or city is null or state is null) and (vin is null or "vehicleModelId" is not null) and coalesce(array_length(images,1),0)>=1 and "conversionType"<>'unknown') s1_5,
 count(*) filter (where "detailScrapedAt" is not null and lat is not null) d_and_geo,
 count(*) filter (where "detailScrapedAt" is not null and "vehicleModelId" is not null) d_and_model,
 count(*) filter (where coalesce(array_length(images,1),0)>1) multi_img,
 count(*) filter (where vin is not null and "vehicleModelId" is null) vin_not_decoded
from e;
select count(*) from listings where "vehicleModelId" is not null and "vehicleId" is null;
