// src/utils/logger.js
//
// Structured JSON logging with secret-field redaction (F-47). Swaps the
// ad-hoc "console.error([module] ...)" mix with one place that knows which
// fields must never be written to stdout/stderr.

export function redact(value) {
    const SENSITIVE_KEYS = new Set([
        "authorization",
        "cookie",
        "token",
        "fcmtoken",
        "publickey",
        "privatekey",
        "encryptedprivatekey",
        "salt",
        "iv",
        "password",
        "secret",
        "details",
    ]);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [
                key,
                SENSITIVE_KEYS.has(String(key).toLowerCase().replace(/[^a-z]/g, ""))
                    ? "[REDACTED]"
                    : redact(entry),
            ])
        );
    }
    return value;
}

function write(level, message, context) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: String(message),
    };
    if (context && typeof context === "object") {
        Object.assign(entry, redact(context));
    }
    // eslint-disable-next-line no-console
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
}

export const logger = {
    info(message, context) {
        write("info", message, context);
    },
    warn(message, context) {
        write("warn", message, context);
    },
    error(message, context) {
        write("error", message, context);
    },
};

export function requestContext(req) {
    return {
        method: req?.method,
        path: req?.originalUrl || req?.url,
        status: req?.res?.statusCode,
        rid: req?.rid || req?.id,
        uid: req?.firebaseUser?.uid || req?.userDoc?._id?.toString() || req?.resource?.scope?.user,
    };
}

export default logger;