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

        // 2. Find user in MongoDB
        let user = await User.findOne({ firebaseID });

        // 3. If user not found => require first/last name to create
        if (!user) {
            const { firstName, lastName, fcmToken } = req.body;

            if (!firstName || !lastName)
                return res.status(403).json({
                    error: "User doesn't exist. Send firstName and lastName to create."
                });

            user = await User.create({
                firebaseID,
                firstName,
                lastName,
                email: firebaseEmail,
                fcmTokens: fcmToken ? [fcmToken] : []
            });
        }

        // 4. If fcmToken provided => add to device list (no duplicates)
        const { fcmToken } = req.body;
        if (fcmToken) {
            if (!user.fcmTokens.includes(fcmToken)) {
                user.fcmTokens.push(fcmToken);
                await user.save();
            }
        }

        // 5. Attach user document to request
        req.userDoc = user;

        next();

    } catch (err) {
        return res.status(401).json({
            error: "Invalid Firebase token",
            details: err.message
        });
    }
}
