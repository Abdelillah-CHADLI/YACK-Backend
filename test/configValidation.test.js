import assert from "node:assert/strict";
import test from "node:test";

process.env.YACK_DISABLE_BOOT_VALIDATE = "1";

const {
    collectConfigGaps,
    isProduction,
    validateEnv,
} = await import("../src/config/validateEnv.js");
const { resolveMongoUri } = await import("../src/config/mongo.js");

const DEV_FALLBACK_URI = "mongodb://127.0.0.1:27017/yack";

test("isProduction reads NODE_ENV", () => {
    assert.equal(isProduction({ NODE_ENV: "production" }), true);
    assert.equal(isProduction({}), false);
    assert.equal(isProduction({ NODE_ENV: "development" }), false);
});

test("collectConfigGaps: full production environment has no gaps", () => {
    const env = {
        MONGO_URI: "mongodb://x",
        FIREBASE_PROJECT_ID: "p",
        FIREBASE_CLIENT_EMAIL: "e",
        FIREBASE_PRIVATE_KEY: "k",
        CLOUDINARY_CLOUD_NAME: "c",
        CLOUDINARY_API_KEY: "k",
        CLOUDINARY_API_SECRET: "s",
        ADMIN_EMAILS: "a@b.c",
        ADMIN_REVIEW_PUBLIC_KEY: "pub",
        CORS_ORIGINS: "https://admin.example.com",
    };
    assert.deepEqual(collectConfigGaps(env, true), []);
});

test("collectConfigGaps: production reports every missing required value", () => {
    const gaps = collectConfigGaps(
        { MONGO_URI: "mongodb://x", FIREBASE_PROJECT_ID: "p" },
        true
    );
    assert.ok(gaps.includes("GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY"));
    for (const required of [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
        "ADMIN_EMAILS",
        "ADMIN_REVIEW_PUBLIC_KEY",
        "CORS_ORIGINS",
    ]) {
        assert.ok(gaps.includes(required), `expected ${required} to be reported`);
    }
});

test("collectConfigGaps: whitespace-only values count as missing", () => {
    assert.deepEqual(
        collectConfigGaps({ MONGO_URI: "   " }, true).includes("MONGO_URI"),
        true
    );
});

test("collectConfigGaps: Firebase satisfied by env vars OR GOOGLE_APPLICATION_CREDENTIALS", () => {
    const base = { MONGO_URI: "mongodb://x" };
    const byEnv = collectConfigGaps(
        { ...base, FIREBASE_PROJECT_ID: "p", FIREBASE_CLIENT_EMAIL: "e", FIREBASE_PRIVATE_KEY: "k" },
        false
    );
    assert.ok(!byEnv.some((g) => g.startsWith("GOOGLE_APPLICATION_CREDENTIALS")));

    const byFile = collectConfigGaps({ ...base, GOOGLE_APPLICATION_CREDENTIALS: "/path/sa.json" }, false);
    assert.ok(!byFile.some((g) => g.startsWith("GOOGLE_APPLICATION_CREDENTIALS")));

    const missing = collectConfigGaps(base, false);
    assert.ok(missing.includes("GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY"));
});

test("validateEnv throws in production with missing configuration", () => {
    assert.throws(
        () => validateEnv({ env: { NODE_ENV: "production", MONGO_URI: "mongodb://x" }, production: true }),
        /Missing required environment variables/
    );
});

test("validateEnv does not throw in development", () => {
    const warnings = [];
    assert.doesNotThrow(() =>
        validateEnv({
            env: { MONGO_URI: DEV_FALLBACK_URI },
            production: false,
            log: { warn: (m) => warnings.push(m) },
        })
    );
    assert.ok(warnings.length > 0, "development mode should still surface warnings");
});

test("resolveMongoUri keeps the explicit URI and refuses missing URI in production", () => {
    assert.equal(resolveMongoUri({ MONGO_URI: "mongodb://atlas/x" }), "mongodb://atlas/x");
    assert.throws(() => resolveMongoUri({}, true), /MONGO_URI is required in production/);
});

test("resolveMongoUri falls back to localhost outside production", () => {
    assert.equal(resolveMongoUri({}, false), DEV_FALLBACK_URI);
});