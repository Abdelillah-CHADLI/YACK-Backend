import admin from "../config/firebase.js";
import User from "../models/User.js";

export async function sendNotification(userID, title, body, data = {}) {
    const user = await User.findById(userID);


    if (!user || !user.fcmTokens.length)
        return;

    // FCM requires ALL data values to be strings
    const safeData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const messages = user.fcmTokens.map(token => ({
        token,
        notification: {
            title,
            body
        },
        data: safeData,
        android: { priority: "high" },  // faster
        apns: { headers: { "apns-priority": "10" } }
    }));

    const response = await admin.messaging().sendEach(messages);

    // Remove tokens that are invalid
    const errorsToRemove = [
        "messaging/invalid-registration-token",
        "messaging/registration-token-not-registered"
    ];

    let changed = false;

    response.responses.forEach((res, idx) => {
        console.log(`FCM response for token ${user.fcmTokens[idx]}:`, res);
        if (!res.success && res.error) {
            const errCode = res.error.code;

            if (errorsToRemove.includes(errCode)) {
                const badToken = user.fcmTokens[idx];
                user.fcmTokens = user.fcmTokens.filter(t => t !== badToken);
                changed = true;
            }
        }
    });

    if (changed) await user.save();

    return response;
}
