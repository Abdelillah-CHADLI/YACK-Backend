import User from "../models/User.js";
import { normalizeFcmToken } from "../utils/fcmToken.js";

const MAX_NAME_LENGTH = 80;
const MAX_KEY_LENGTH = 32 * 1024;
const MAX_KEY_PARAMETER_LENGTH = 4096;

function requiredString(value, label, maxLength) {
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(`${label} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > maxLength) {
        throw new RangeError(`${label} is too long`);
    }
    return normalized;
}

function userResponse(user) {
    return {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        publicKey: user.publicKey,
        encryptedPrivateKey: user.encryptedPrivateKey,
        isComplete: user.isComplete,
        salt: user.salt,
        iv: user.iv,
        language: user.language,
    };
}

/** Complete account setup. Safe to retry with the same generated key. */
export const finalizeAccount = async (req, res) => {
    if (!req.emailVerified) {
        return res.status(403).json({
            error: "Email must be verified before finalizing account",
            code: "EMAIL_NOT_VERIFIED",
        });
    }

    let values;
    try {
        values = {
            firstName: requiredString(
                req.body?.firstName,
                "First name",
                MAX_NAME_LENGTH
            ),
            lastName: requiredString(
                req.body?.lastName,
                "Last name",
                MAX_NAME_LENGTH
            ),
            publicKey: requiredString(
                req.body?.publicKey,
                "Public key",
                MAX_KEY_LENGTH
            ),
            encryptedPrivateKey: requiredString(
                req.body?.encryptedPrivateKey,
                "Encrypted private key",
                MAX_KEY_LENGTH
            ),
            salt: requiredString(
                req.body?.salt,
                "Salt",
                MAX_KEY_PARAMETER_LENGTH
            ),
            iv: requiredString(
                req.body?.iv,
                "IV",
                MAX_KEY_PARAMETER_LENGTH
            ),
        };
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const updated = await User.findOneAndUpdate(
            { _id: req.userDoc._id, isComplete: false },
            { $set: { ...values, isComplete: true } },
            { new: true, runValidators: true }
        );

        if (updated) {
            return res.json({ success: true, user: userResponse(updated) });
        }

        // A lost response should not force users into an unrecoverable setup loop.
        const existing = await User.findById(req.userDoc._id);
        if (existing?.isComplete && existing.publicKey === values.publicKey) {
            return res.json({
                success: true,
                alreadyFinalized: true,
                user: userResponse(existing),
            });
        }

        return res.status(409).json({
            error: "Account is already finalized with a different key",
            code: "ACCOUNT_ALREADY_FINALIZED",
        });
    } catch (error) {
        console.error("[user] Failed to finalize account:", error.message);
        return res.status(500).json({ error: "Failed to finalize account" });
    }
};

/** Return the authenticated user's profile, including encrypted key material. */
export const getProfile = async (req, res) => {
    try {
        return res.json({ success: true, user: userResponse(req.userDoc) });
    } catch (error) {
        console.error("[user] Failed to get profile:", error.message);
        return res.status(500).json({ error: "Failed to get profile" });
    }
};

/** Update the encrypted private key while preserving the public identity key. */
export const updatePrivateKey = async (req, res) => {
    let values;
    try {
        values = {
            encryptedPrivateKey: requiredString(
                req.body?.encryptedPrivateKey,
                "Encrypted private key",
                MAX_KEY_LENGTH
            ),
            salt: requiredString(
                req.body?.salt,
                "Salt",
                MAX_KEY_PARAMETER_LENGTH
            ),
            iv: requiredString(
                req.body?.iv,
                "IV",
                MAX_KEY_PARAMETER_LENGTH
            ),
        };
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const updated = await User.findOneAndUpdate(
            { _id: req.userDoc._id, isComplete: true },
            { $set: values },
            { new: true, runValidators: true }
        );
        if (!updated) {
            return res.status(409).json({
                error: "Account setup must be completed first",
                code: "ACCOUNT_INCOMPLETE",
            });
        }
        return res.json({ success: true, message: "Private key updated successfully" });
    } catch (error) {
        console.error("[user] Failed to update private key:", error.message);
        return res.status(500).json({ error: "Failed to update private key" });
    }
};

export const updateProfile = async (req, res) => {
    const body = req.body || {};
    const nextValues = {};

    try {
        if (Object.hasOwn(body, "firstName")) {
            nextValues.firstName = requiredString(
                body.firstName,
                "First name",
                MAX_NAME_LENGTH
            );
        }
        if (Object.hasOwn(body, "lastName")) {
            nextValues.lastName = requiredString(
                body.lastName,
                "Last name",
                MAX_NAME_LENGTH
            );
        }
        if (Object.hasOwn(body, "language")) {
            if (typeof body.language !== "string" || !["en", "fr", "ar"].includes(body.language)) {
                throw new TypeError("Language must be en, fr, or ar");
            }
            nextValues.language = body.language;
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    if (!Object.keys(nextValues).length) {
        return res.status(400).json({ error: "Nothing to update" });
    }

    try {
        const updated = await User.findByIdAndUpdate(
            req.userDoc._id,
            { $set: nextValues },
            { new: true, runValidators: true }
        );
        if (!updated) {
            return res.status(404).json({ error: "User not found" });
        }
        return res.json({ success: true, user: userResponse(updated) });
    } catch (error) {
        console.error("[user] Failed to update profile:", error.message);
        return res.status(500).json({ error: "Failed to update profile" });
    }
};

/** Explicitly bind an FCM device token to the current account. */
export const registerFcmToken = async (req, res) => {
    const token = normalizeFcmToken(req.body?.fcmToken || req.headers["x-fcm-token"]);
    if (!token) {
        return res.status(400).json({ error: "A valid FCM token is required" });
    }

    try {
        await User.updateMany(
            { _id: { $ne: req.userDoc._id }, fcmTokens: token },
            { $pull: { fcmTokens: token } }
        );
        await User.updateOne(
            { _id: req.userDoc._id },
            { $addToSet: { fcmTokens: token } }
        );
        return res.json({ success: true });
    } catch (error) {
        console.error("[user] Failed to register FCM token:", error.message);
        return res.status(500).json({ error: "Failed to register notification device" });
    }
};

/** Remove this device's token before local sign-out. */
export const unregisterFcmToken = async (req, res) => {
    const token = normalizeFcmToken(req.body?.fcmToken || req.headers["x-fcm-token"]);
    if (!token) {
        return res.status(400).json({ error: "A valid FCM token is required" });
    }

    try {
        await User.updateOne(
            { _id: req.userDoc._id },
            { $pull: { fcmTokens: token } }
        );
        return res.json({ success: true });
    } catch (error) {
        console.error("[user] Failed to unregister FCM token:", error.message);
        return res.status(500).json({ error: "Failed to unregister notification device" });
    }
};
