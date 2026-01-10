import admin from "../config/firebase.js";
import User from "../models/User.js";
import { NotificationLocalization } from "./notificationLocalization.js";


export async function sendNotification(userID, titleOrType, body = "", data = {}, options = {}) {
    const user = await User.findById(userID);

    if (!user || !user.fcmTokens.length)
        return;

    let title = titleOrType;
    let notificationBody = body;

    // If localization is requested, use NotificationLocalization
    if (options.localize) {
        const userLanguage = user.language || 'en';
        const localized = NotificationLocalization.getNotification(
            titleOrType,
            userLanguage,
            options.params || {}
        );
        title = localized.title;
        notificationBody = localized.body;
    }

    // FCM requires ALL data values to be strings
    const safeData = Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
    );

    const messages = user.fcmTokens.map(token => ({
        token,
        notification: {
            title,
            body: notificationBody
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
