// src/utils/fcmRegistration.js
//
// Pure planning for FCM token binding (F-03). The atomic execution (remove the
// token from every other user + attach it to the caller in ONE database write)
// is delegated to the controller; this module decides what to write so the
// eviction/cap and pipeline-shape rules are unit-testable without a database.

export const MAX_FCM_TOKENS_PER_USER = 5;

/**
 * Decide how to bind `token` to `userId` given the tokens the user currently
 * owns.
 *
 * Returns either a "already-bound" decision (idempotent success) or a "bind"
 * decision carrying the atomic filter + pipeline built for mongoose updateMany.
 */
export function planFcmTokenBind({ userId, ownedTokens, token, max = MAX_FCM_TOKENS_PER_USER }) {
    const owned = Array.isArray(ownedTokens) ? ownedTokens.filter((t) => typeof t === "string") : [];

    if (owned.includes(token)) {
        return { decision: "already-bound" };
    }

    // Bounded registration: when the cap is reached the oldest token is
    // evicted, so one account can never accumulate unbounded devices.
    let targetTokens = [...owned];
    if (targetTokens.length >= max) {
        targetTokens = targetTokens.slice(-(max - 1));
    }
    targetTokens.push(token);

    // The filter touches only documents that can be affected: the caller, or
    // any user that currently holds the token. The pipeline removes the token
    // from everyone but the caller and attaches it to the caller in a single
    // server-side write, so there is no interleaving between "remove" and
    // "add". The partial unique index on fcmTokens backstops uniqueness.
    const filter = { $or: [{ _id: userId }, { fcmTokens: token }] };
    const pipeline = [
        {
            $set: {
                fcmTokens: {
                    $cond: [
                        { $eq: ["$_id", userId] },
                        targetTokens,
                        {
                            $filter: {
                                input: { $ifNull: ["$fcmTokens", []] },
                                as: "t",
                                cond: { $ne: ["$$t", token] },
                            },
                        },
                    ],
                },
            },
        },
    ];

    return { decision: "bind", filter, pipeline, targetTokens };
}