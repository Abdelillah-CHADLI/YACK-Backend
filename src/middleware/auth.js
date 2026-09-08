// src/middleware/auth.js
//
// Firebase ID-token verification (F-70): tokens are verified with
// `checkRevoked: true` so revoked sessions stop working immediately instead of
// keeping full access until natural expiry. Accounts flagged `blocked` on the
// User document are rejected with 403 ACCOUNT_BLOCKED.
//
// The middleware is created through createAuthMiddleware({ firebaseAdmin,
// UserModel }) so unit tests can exercise it without initializing the Firebase
// Admin SDK or a database connection.

import User from "../models/User.js";

function bearerToken(header) {
    if (typeof header !== "string") return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

export function createAuthMiddleware({ firebaseAdmin, UserModel }) {
    return async function auth(req, res, next) {
        const token = bearerToken(req.headers.authorization);
        if (!token) {
            return res.status(401).json({ error: "Bearer auth token required" });
        }

        try {
            const decoded = await firebaseAdmin.auth().verifyIdToken(token, { checkRevoked: true });
            const firebaseID = decoded.uid;
            const firebaseEmail = typeof decoded.email === "string" ? decoded.email : "";
            let emailVerified = decoded.email_verified === true;

            // A token issued before the user clicks the verification link keeps an
            // old email_verified claim until it is refreshed. Check Firebase's live
            // user record in that one stale-token case so account setup can continue
            // without relying on a client-side forced token refresh.
            if (!emailVerified) {
                const firebaseUser = await firebaseAdmin.auth().getUser(firebaseID);
                emailVerified = firebaseUser.emailVerified === true;
            }

            const update = {
                $setOnInsert: {
                    firebaseID,
                    firstName: "",
                    lastName: "",
                    isComplete: false,
                    blocked: false,
                    fcmTokens: [],
                },
            };
            if (firebaseEmail) {
                update.$set = { email: firebaseEmail };
            }

            // Upsert avoids duplicate-key failures when a user's first requests arrive
            // concurrently after sign-up.
            const user = await UserModel.findOneAndUpdate(
                { firebaseID },
                update,
                { new: true, upsert: true, setDefaultsOnInsert: true }
            );

            if (user?.blocked) {
                return res.status(403).json({
                    error: "Account is blocked",
                    code: "ACCOUNT_BLOCKED",
                });
            }

            req.userDoc = user;
            req.emailVerified = emailVerified;
            req.firebaseUser = decoded;
            next();
        } catch (error) {
            console.warn("[auth] Token verification failed:", error.code || error.message);
            return res.status(401).json({ error: "Invalid or expired Firebase token" });
        }
    };
}

let firebaseAdminPromise;

function resolveFirebaseAdmin() {
    // Loaded lazily so the default middleware can be imported in unit tests
    // without initializing the Firebase Admin SDK.
    firebaseAdminPromise ||= import("../config/firebase.js").then((module) => module.default);
    return firebaseAdminPromise;
}

export default async function auth(req, res, next) {
    const firebaseAdmin = await resolveFirebaseAdmin();
    return createAuthMiddleware({ firebaseAdmin, UserModel: User })(req, res, next);
}