# Deployment

Deploy three independently configured containers: API, admin and Mini App. Use managed Supabase PostgreSQL/Storage and managed Redis where suitable. Production requires HTTPS, non-public storage, migrations run once by a controlled release job, structured logs, health checks and backup/restore testing.

Do not deploy until Telegram callback/Mini App URLs, CORS origins, secrets, database connection pooling and worker process configuration are verified in the target environment.
