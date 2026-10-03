ALTER TABLE "AttendanceRecord"
  ADD COLUMN "checkInStatus" "AttendanceStatus",
  ADD COLUMN "checkOutStatus" "AttendanceStatus";

UPDATE "AttendanceRecord"
SET "checkInStatus" = CASE
  WHEN "checkInAt" IS NULL THEN NULL
  WHEN "status" IN ('ON_TIME', 'LATE', 'OUTSIDE_GEOFENCE', 'LOW_ACCURACY', 'PENDING_REVIEW') THEN "status"
  ELSE NULL
END,
"checkOutStatus" = CASE
  WHEN "checkOutAt" IS NULL THEN NULL
  WHEN "status" IN ('COMPLETED', 'EARLY_CHECKOUT', 'OUTSIDE_GEOFENCE', 'LOW_ACCURACY', 'PENDING_REVIEW') THEN "status"
  ELSE NULL
END;
