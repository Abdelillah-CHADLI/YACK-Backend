// src/middleware/rateLimiters.js
//
// Layered request throttling (F-02):
//   1. globalApiLimiter  — per-IP ceiling over the whole API.
//   2. createUserLimiter — per-user ceiling for authenticated write routes,
//      keyed by the Firebase UID (falling back to IP for unauthenticated
//      callers), with stricter limits negotiated per route.
//
// The in-memory store is correct for a single bootstrap instance. If the
// backend is ever scaled to multiple instances, move to a shared store (e.g.
// Redis) or the limits will be enforced per instance, not globally.

import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

const TOO_MANY = { error: "Too many requests, please try again later", code: "RATE_LIMITED" };

function keyForRequest(req) {
    if (req.firebaseUser?.uid) return `u:${req.firebaseUser.uid}`;
    return ipKeyGenerator().keyGenerator(req);
}

export const globalApiLimiter = rateLimit({
    windowMs: FIFTEEN_MINUTES,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: TOO_MANY,
    skip: (req) =>
        req.method === "GET" &&
        (req.path === "/" || req.path === "/health" || req.path === "/health/ready"),
});

export function createUserLimiter({ windowMs = FIFTEEN_MINUTES, limit }) {
    return rateLimit({
        windowMs,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: TOO_MANY,
        keyGenerator: keyForRequest,
    });
}

// General authenticated writes (contract actions, messages, support threads).
export const userWriteLimiter = createUserLimiter({ limit: 200 });

// Stricter than the general write limit because /user/finalize create the
// account row (F-35): it throttles first-touch account creation bursts.
export const accountSetupLimiter = createUserLimiter({ limit: 20 });

// Uploads burn Cloudinary storage/transfer quota, so they get a tighter cap.
export const mediaUploadLimiter = createUserLimiter({ limit: 30 });

// Dispute submissions are append-only records reviewed by humans.
export const disputeLimiter = createUserLimiter({ limit: 10 });