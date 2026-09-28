# API Contract

All routes use `/api/v1`. DTOs are defined in `packages/contracts` with runtime validation. The API returns stable error codes and safe human-readable messages.

## MVP endpoints

| Method | Route | Audience | Purpose |
| --- | --- | --- | --- |
| POST | `/telegram/session` | worker | verify init data and establish worker session |
| GET | `/worker/today` | worker | resolved assignment and today's attendance state |
| POST | `/attendance/check-in` | worker | idempotent GPS-backed check-in |
| POST | `/attendance/check-out` | worker | idempotent GPS-backed check-out |
| GET | `/attendance/today` | authorized admin | scoped daily attendance |
| GET | `/attendance/:id` | authorized admin | record, events and authorized evidence |
| POST | `/employees` | HR | create employee |
| POST | `/projects` | HR/owner | create project |
| POST | `/sites` | scoped manager | create site/geofence |
| POST | `/assignments` | HR/project manager | assign employee to site/schedule |

## Attendance write contract

`POST /attendance/check-in` and checkout require an `Idempotency-Key` header plus body fields: `latitude`, `longitude`, `accuracyMeters`, optional `capturedAt`, and optional safe device context. The server records receipt time separately.

Responses contain `attendanceId`, current attendance status, verification result, official server timestamp and user-safe message. They must never expose another worker's data.

## Error codes

Use domain codes: `TELEGRAM_INVALID`, `EMPLOYEE_INACTIVE`, `NO_VALID_ASSIGNMENT`, `AMBIGUOUS_ASSIGNMENT`, `LOCATION_UNAVAILABLE`, `LOW_ACCURACY`, `OUTSIDE_GEOFENCE`, `ALREADY_CHECKED_IN`, `NO_OPEN_ATTENDANCE`, `FORBIDDEN_SCOPE`, `IDEMPOTENCY_CONFLICT`.
