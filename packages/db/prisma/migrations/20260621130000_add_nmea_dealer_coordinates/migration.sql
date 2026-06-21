-- Add city, lat, lng to nmea_dealers for proximity search
ALTER TABLE "nmea_dealers" ADD COLUMN "city" TEXT;
ALTER TABLE "nmea_dealers" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "nmea_dealers" ADD COLUMN "lng" DOUBLE PRECISION;
