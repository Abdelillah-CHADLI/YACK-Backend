import admin from "../config/firebase.js";

export default async function auth(req, res, next) {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token)
        return res.status(401).json({ error: "No token" });

    try {
        req.user = await admin.auth().verifyIdToken(token);
        next();
    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
}
