// src/config/cors.js
//
// CORS origin allowlist (F-68). Any browser origin not present in
// CORS_ORIGINS (or a local development origin, outside production) is denied
// CORS headers. Native mobile clients are unaffected: they send no Origin
// header and the cors middleware ignores them.
//
// Production requires CORS_ORIGINS to be set (see validateEnv.js). When it is
// missing, cross-origin browser access is refused instead of being opened to
// the whole internet.

const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

export function parseCorsOrigins(value) {
    return String(value || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
}

export function isAllowedOrigin(origin, configured, production) {
    if (!origin) {
        // No Origin header: same-origin or non-browser client; allowed.
        return true;
    }
    if (configured.includes("*")) {
        return true;
    }
    const normalizedOrigin = origin.replace(/\/$/, "");
    if (configured.some((entry) => normalizedOrigin === entry.replace(/\/$/, ""))) {
        return true;
    }
    if (!production && LOCALHOST_PATTERN.test(origin)) {
        return true;
    }
    return false;
}

export function buildCorsOptions({ corsOrigins, production }) {
    const configured = parseCorsOrigins(corsOrigins);
    return {
        origin(origin, callback) {
            callback(null, isAllowedOrigin(origin, configured, production));
        },
    };
}