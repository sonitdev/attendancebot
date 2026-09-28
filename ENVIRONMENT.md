# Environment

All values live in local `.env` files or a secret manager. `.env.example` documents names only. Rotate Telegram/auth secrets after suspected disclosure. The browser applications receive only explicitly public variables; database URLs, Redis URLs and service keys stay API/worker-only.
