import admin from "../config/firebase.js";
import User from "../models/User.js";

export default async function auth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token)
            return res.status(401).json({ error: "No auth token" });

        // 1. Verify Firebase token
        const decoded = await admin.auth().verifyIdToken(token);
        const firebaseID = decoded.uid;
        const firebaseEmail = decoded.email || "";
        const emailVerified = decoded.email_verified || false;

        // 2. Find user in MongoDB or create placeholder
        let user = await User.findOne({ firebaseID });

        if (!user) {
            user = await User.create({
                firebaseID,
                firstName: "",
                lastName: "",
                email: firebaseEmail,
                isComplete: false,
                fcmTokens: []
            });
        }

        // 3. If fcmToken provided => add to device list (no duplicates)
        const { fcmToken } = req.body;
        if (fcmToken) {
            if (!user.fcmTokens.includes(fcmToken)) {
                user.fcmTokens.push(fcmToken);
                await user.save();
            }
        }

        // 4. Attach user document and email verification status to request
        req.userDoc = user;
        req.emailVerified = emailVerified;

        next();

    } catch (err) {
        return res.status(401).json({
            error: "Invalid Firebase token",
            details: err.message
        });
    }
}
