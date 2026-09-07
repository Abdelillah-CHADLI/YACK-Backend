import admin from "../config/firebase.js";
import User from "../models/User.js";
import { normalizeFcmToken } from "../utils/fcmToken.js";

function bearerToken(header) {
    if (typeof header !== "string") return null;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

async function registerDeviceToken(user, rawToken) {
    const fcmToken = normalizeFcmToken(rawToken);
    if (!fcmToken) return user;

    try {
        // A device token belongs to one signed-in account at a time. Remove it
        // from previous accounts before registering it for this one.
        await User.updateMany(
            { _id: { $ne: user._id }, fcmTokens: fcmToken },
            { $pull: { fcmTokens: fcmToken } }
        );
        return await User.findByIdAndUpdate(
            user._id,
            { $addToSet: { fcmTokens: fcmToken } },
            { new: true }
        ) || user;
    } catch (error) {
        // Push registration must not block an otherwise valid API request.
        console.warn("[auth] Could not refresh the device push token:", error.message);
        return user;
    }
}

export default async function auth(req, res, next) {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
        return res.status(401).json({ error: "Bearer auth token required" });
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        const firebaseID = decoded.uid;
        const firebaseEmail = typeof decoded.email === "string" ? decoded.email : "";

        const update = {
            $setOnInsert: {
                firebaseID,
                firstName: "",
                lastName: "",
                isComplete: false,
                fcmTokens: [],
            },
        };
        if (firebaseEmail) {
            update.$set = { email: firebaseEmail };
        }

        // Upsert avoids duplicate-key failures when a user's first requests arrive
        // concurrently after sign-up.
        let user = await User.findOneAndUpdate(
            { firebaseID },
            update,
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        const suppliedFcmToken = req.headers["x-fcm-token"] || req.body?.fcmToken;
        user = await registerDeviceToken(user, suppliedFcmToken);

        req.userDoc = user;
        req.emailVerified = decoded.email_verified === true;
        req.firebaseUser = decoded;
        next();
    } catch (error) {
        console.warn("[auth] Token verification failed:", error.code || error.message);
        return res.status(401).json({ error: "Invalid or expired Firebase token" });
    }
}
