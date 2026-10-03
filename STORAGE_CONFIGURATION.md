# Supabase Storage Configuration

The API uses Supabase Storage only through the server-side service-role key. Never expose `SUPABASE_SERVICE_ROLE_KEY` to either browser application.

## Required environment

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: server-only key used by the NestJS API.

## `attendance-evidence`

Create a private bucket named `attendance-evidence`.

- Public access: disabled.
- Uploads: performed only by the NestJS API.
- Reads: performed through API-generated signed URLs.
- Signed URL lifetime: 900 seconds (15 minutes).
- Object paths are organization-scoped by the API; clients must never submit or receive raw storage paths as authorization.
- Do not add a broad anonymous or authenticated `SELECT`, `INSERT`, `UPDATE`, or `DELETE` policy. The API service role owns access.

## `company-branding`

Create a bucket named `company-branding`.

- Public access: enabled, because saved organization logo URLs are rendered directly by the Admin and Mini App shells.
- Upload/update: server only through the service-role key.
- Object path: `<organizationId>/portal-logo.<extension>`.
- Do not allow browser-side uploads directly to this bucket.

If branding must be private in a future deployment, change the API to issue signed logo URLs before disabling public access; do not simply make the current URL private.

## Telegram health sync

Set `TELEGRAM_HEALTH_SYNC_ENABLED=true` to enable the API background probe for every non-archived Telegram-linked project. `TELEGRAM_HEALTH_SYNC_INTERVAL_MS` defaults to 900000 milliseconds and cannot be set below 60000 milliseconds. Manual health refresh remains available in Admin.
