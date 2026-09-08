// src/config/validateEnv.js
//
// Boot-time configuration gate (F-08, F-69).
//
// Production (NODE_ENV=production) refuses to start when a required value is
// missing, so a misconfigured deployment surfaces immediately instead of
// degrading silently (an empty ADMIN_EMAILS allowlist, a lazy Cloudinary
// configuration that only fails on the first upload, an unset admin review
// key).
//
// Local development is still allowed to boot with warnings so reduced-feature
// modes remain usable (e.g. a localhost MongoDB fallback), but every missing
// value is reported and SETUP.md describes what production requires.
//
// index.js imports and calls validateEnv() BEFORE any module that opens an
// external connection (MongoDB, Firebase, Cloudinary).

const FIREBASE_ENV_VARS = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
];

const FIREBASE_ALTERNATIVE = "GOOGLE_APPLICATION_CREDENTIALS";

// Only enforced when NODE_ENV=production.
const PRODUCTION_REQUIRED = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "ADMIN_EMAILS",
    "ADMIN_REVIEW_PUBLIC_KEY",
    "CORS_ORIGINS",
];

export function isProduction(env = process.env) {
    return env.NODE_ENV === "production";
}

function present(value) {
    return typeof value === "string" && value.trim().length > 0;
}

/**
 * Returns the list of missing configuration values given an environment object
 * and the expected mode. Pure and synchronous so it can be unit tested without
 * touching the network.
 */
export function collectConfigGaps(env = process.env, production = isProduction(env)) {
    const gaps = [];

    if (!present(env.MONGO_URI)) {
        gaps.push("MONGO_URI");
    }

    const firebaseByEnv = FIREBASE_ENV_VARS.every((name) => present(env[name]));
    const firebaseByFile = present(env[FIREBASE_ALTERNATIVE]);
    if (!firebaseByEnv && !firebaseByFile) {
        gaps.push(`${FIREBASE_ALTERNATIVE} or ${FIREBASE_ENV_VARS.join("/")}`);
    }

    if (production) {
        for (const name of PRODUCTION_REQUIRED) {
            if (!present(env[name])) gaps.push(name);
        }
    }
    return gaps;
}

export function validateEnv({ env = process.env, production = isProduction(env), log = console } = {}) {
    const gaps = collectConfigGaps(env, production);

    if (production && gaps.length) {
        throw new Error(
            "Missing required environment variables in production: " +
            `${gaps.join(", ")}. ` +
            "Refusing to start; see SETUP.md for the full list and how to set them."
        );
    }

    if (gaps.length) {
        log.warn(
            `[config] Running with missing environment variables: ${gaps.join(", ")}. ` +
            "Local development mode: continuing. " +
            "In production (NODE_ENV=production) the server refuses to start until these are set."
        );
    }
}

// Side effect: validate at module evaluation time. ES module dependencies are
// evaluated in import-declaration order, so listing this module first in
// index.js guarantees the configuration gate runs before MongoDB, Firebase or
// the route graph can initialize (some modules statically import firebase).
// Tests may set YACK_DISABLE_BOOT_VALIDATE=1 before importing to suppress it.
if (process.env.YACK_DISABLE_BOOT_VALIDATE !== "1") {
    validateEnv();
}