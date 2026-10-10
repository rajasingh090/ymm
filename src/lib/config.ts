// =========================================================
// GYMPULSE AI SOURCE CONFIGURATION
// =========================================================
// Optional single-instance health monitor. Paste your deployed URL here,
// for example: https://your-service.onrender.com
// An empty URL or placeholder hostname is intentionally rejected.
export const SELF_PING_URL = "";
export const ENABLE_SELF_PING = false;
export const SELF_PING_INTERVAL_SECONDS = 600;
export const SELF_PING_TIMEOUT_SECONDS = 15;

// The app uses a PostgreSQL connection supplied by the hosting platform.
// AI credentials are read on the server only from GYMPULSE_AI_API_KEY.
// Personal access protection can be enabled with GYMPULSE_ACCESS_PASSWORD
// (and preferably GYMPULSE_AUTH_SECRET) in the hosting service settings.
