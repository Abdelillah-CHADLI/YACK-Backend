import admin from "../config/firebase.js";
import User from "../models/User.js";

export default async function auth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ error: "No token" });

    try {
        // 1. Verify Firebase ID token
        const decoded = await admin.auth().verifyIdToken(token);
        const firebaseID = decoded.uid;

        // 2. Try to find user in MongoDB
        let user = await User.findOne({ firebaseID });

        // 3. If not found => client must provide first/last name to create
        if (!user) {
            const { firstName, lastName, email, fcmToken } = req.body;

            if (!firstName || !lastName || !email)
                return res.status(403).json({
                    error: "User not found in DB. Provide firstName, lastName, email to create user."
                });

            // Create new user
            user = await User.create({
                firebaseID,
                firstName,
                lastName,
                email,
                fcmToken: fcmToken || ""
            });
        }

        // Attach the MongoDB document to request
        req.userDoc = user;

        next();

    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
}
