import admin from "../config/firebase.js";
import User from "../models/User.js";
import { normalizeFcmToken } from "./fcmToken.js";
import { NotificationLocalization } from "./notificationLocalization.js";

const FCM_BATCH_LIMIT = 500;
const INVALID_TOKEN_CODES = new Set([
    "messaging/invalid-registration-token",
    "messaging/registration-token-not-registered",
]);

function stringifyData(data) {
    return Object.fromEntries(
        Object.entries(data || {})
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => [String(key), String(value).slice(0, 1000)])
    );
}

function chunks(values, size) {
    const result = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

/**
 * Deliver a push notification without ever failing the business operation that
 * triggered it. Invalid tokens are pruned atomically after Firebase reports them.
 */
export async function sendNotification(
    userID,
    titleOrType,
    body = "",
    data = {},
    options = {}
) {
    try {
        const user = await User.findById(userID).select("fcmTokens language");
        if (!user) {
            return { successCount: 0, failureCount: 0, skipped: "user-not-found" };
        }

        const tokens = [...new Set(user.fcmTokens.map(normalizeFcmToken).filter(Boolean))];
        if (!tokens.length) {
            return { successCount: 0, failureCount: 0, skipped: "no-valid-tokens" };
        }

        let title = String(titleOrType || "YACK");
        let notificationBody = String(body || "");
        if (options.localize) {
            const localized = NotificationLocalization.getNotification(
                titleOrType,
                user.language || "en",
                options.params || {}
            );
            title = localized.title;
            notificationBody = localized.body;
        }

        const safeData = stringifyData(data);
        const invalidTokens = new Set();
        let successCount = 0;
        let failureCount = 0;

        for (const tokenBatch of chunks(tokens, FCM_BATCH_LIMIT)) {
            const messages = tokenBatch.map((token) => ({
                token,
                notification: {
                    title: String(title).slice(0, 200),
                    body: String(notificationBody).slice(0, 1000),
                },
                data: safeData,
                android: { priority: "high" },
                apns: { headers: { "apns-priority": "10" } },
            }));

            const response = await admin.messaging().sendEach(messages);
            successCount += response.successCount;
            failureCount += response.failureCount;

            response.responses.forEach((result, index) => {
                if (!result.success && INVALID_TOKEN_CODES.has(result.error?.code)) {
                    invalidTokens.add(tokenBatch[index]);
                }
            });
        }

        if (invalidTokens.size) {
            await User.updateOne(
                { _id: user._id },
                { $pull: { fcmTokens: { $in: [...invalidTokens] } } }
            );
        }

        if (failureCount) {
            console.warn(
                `[notifications] Delivery completed with ${failureCount} failure(s) ` +
                `for user ${user._id}`
            );
        }
        return { successCount, failureCount, removedTokens: invalidTokens.size };
    } catch (error) {
        // Notifications are secondary to the persisted contract/message/media action.
        console.error("[notifications] Best-effort delivery failed:", error.message);
        return { successCount: 0, failureCount: 1, error: error.message };
    }
}
