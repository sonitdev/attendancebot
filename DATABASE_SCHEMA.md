# Database Schema

## Tenant invariant

Every tenant-owned table includes `organization_id`. Relations and query helpers must make organization scoping mandatory.

## MVP entities

| Entity | Purpose | Key constraints |
| --- | --- | --- |
| Organization | Tenant boundary | unique slug |
| User, Role, UserRole | Management identity/RBAC | unique active role mapping |
| Employee | Worker profile | `(organization_id, employee_code)` unique |
| TelegramAccount | Verified Telegram identity | active `telegram_user_id` linked once |
| Project, Site | Work hierarchy/geofence | site belongs to project and has IANA timezone |
| WorkSchedule | Shift rules | tenant-scoped, versioned/immutable once used |
| Assignment | Employee-to-site dated work | no ambiguous active assignment without explicit policy |
| AttendanceRecord | Daily assignment attendance | unique open/daily business key as finalized in schema |
| AttendanceEvent | Immutable attempt/outcome timeline | append-only |
| AttendanceCorrection | Reviewable historical correction | never overwrites source facts |
| AuditLog | Sensitive action evidence | append-only with actor + scope |

## Attendance record model

Capture immutable source evidence: server `check_in_at`/`check_out_at`; received coordinate, accuracy and capture timestamp; calculated distance; verification result; assignment/schedule snapshot reference; final attendance state; duration. Store precision appropriate for location evidence and restrict its access.

## Lifecycle

Use explicit statuses rather than deletion for employees, projects, sites and assignments. Audit-sensitive records (attendance events, audit logs, corrections) must not be hard-deleted by application features.
