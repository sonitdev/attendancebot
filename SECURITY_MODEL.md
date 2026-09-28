# Security Model

## Authentication

Management portal authentication uses a server-validated provider session. Worker authentication begins with Telegram Mini App init-data HMAC validation on the API using the bot token; no browser value alone identifies a worker.

## Authorization

Require a user/worker principal, organization scope and permission for every endpoint. Project and site roles add a second scope filter. Worker endpoints always derive `employeeId` from the verified session—not a request parameter.

## Data protection

- Keep Supabase service-role credentials API-only.
- Use HTTPS, secure headers, rate limiting, request validation and least-privilege database credentials.
- Store private evidence in private buckets with short-lived signed URLs after authorization.
- Restrict precise coordinates to authorized operational roles; document retention before collecting production data.
- Redact Telegram init data, tokens and unnecessary coordinates from logs.

## Audit requirements

Audit privileged reads of sensitive location where policy requires it, and every role change, Telegram reassignment, manual attendance, correction, override, warning and assessment. Include actor, organization, target, action, timestamp and request correlation id.
