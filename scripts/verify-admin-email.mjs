import "dotenv/config";
import admin from "../src/config/firebase.js";

const uid = process.argv[2];
if (!uid) {
    console.error("Usage: node scripts/verify-admin-email.mjs <FIREBASE_UID>");
    process.exit(1);
}

try {
    const user = await admin.auth().updateUser(uid, { emailVerified: true });
    console.log("Done:", JSON.stringify({
        uid: user.uid,
        email: user.email,
        emailVerified: user.emailVerified,
        customClaims: await admin.auth().getUser(uid).then((u) => u.customClaims),
    }));
} catch (err) {
    console.error("Failed:", err.message);
    process.exit(1);
}
