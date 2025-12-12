import User from "../models/User.js";

/**
 * Finalize user account - requires verified email, firstName, lastName, publicKey, encryptedPrivateKey
 */
export const finalizeAccount = async (req, res) => {
    try {
        // Check email verification
        if (!req.emailVerified) {
            return res.status(403).json({ error: "Email must be verified before finalizing account" });
        }

        const { firstName, lastName, publicKey, encryptedPrivateKey } = req.body || {};

        // Validate required fields
        if (!firstName || typeof firstName !== "string" || !firstName.trim()) {
            return res.status(400).json({ error: "First name is required" });
        }
        if (!lastName || typeof lastName !== "string" || !lastName.trim()) {
            return res.status(400).json({ error: "Last name is required" });
        }
        if (!publicKey || typeof publicKey !== "string" || !publicKey.trim()) {
            return res.status(400).json({ error: "Public key is required" });
        }
        if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "string" || !encryptedPrivateKey.trim()) {
            return res.status(400).json({ error: "Encrypted private key is required" });
        }

        // Check if already finalized
        if (req.userDoc.isComplete) {
            return res.status(400).json({ error: "Account already finalized" });
        }

        const updated = await User.findByIdAndUpdate(
            req.userDoc._id,
            {
                $set: {
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    publicKey: publicKey.trim(),
                    encryptedPrivateKey: encryptedPrivateKey.trim(),
                    isComplete: true
                }
            },
            { new: true }
        );

        res.json({
            success: true,
            user: {
                id: updated._id,
                firstName: updated.firstName,
                lastName: updated.lastName,
                email: updated.email,
                publicKey: updated.publicKey,
                isComplete: updated.isComplete
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to finalize account" });
    }
};

/**
 * Get user profile including keys
 */
export const getProfile = async (req, res) => {
    try {
        const user = req.userDoc;

        res.json({
            success: true,
            user: {
                id: user._id,
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                publicKey: user.publicKey,
                encryptedPrivateKey: user.encryptedPrivateKey,
                isComplete: user.isComplete
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to get profile" });
    }
};

/**
 * Update encrypted private key (same public key, new encryption)
 */
export const updatePrivateKey = async (req, res) => {
    try {
        const { encryptedPrivateKey } = req.body || {};

        if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "string" || !encryptedPrivateKey.trim()) {
            return res.status(400).json({ error: "Encrypted private key is required" });
        }

        const updated = await User.findByIdAndUpdate(
            req.userDoc._id,
            { $set: { encryptedPrivateKey: encryptedPrivateKey.trim() } },
            { new: true }
        );

        res.json({
            success: true,
            message: "Private key updated successfully"
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update private key" });
    }
};

export const updateProfile = async (req, res) => {

    // body firstName , lastName, profilePicture ( later ) all optional and will be updated after
    // req.userDoc stores user instance

    try {
        const { firstName, lastName } = req.body || {};

        const nextValues = {};
        if (typeof firstName === "string" && firstName.trim()) {
            nextValues.firstName = firstName.trim();
        }

        if (typeof lastName === "string" && lastName.trim()) {
            nextValues.lastName = lastName.trim();
        }

        if (!Object.keys(nextValues).length) {
            return res.status(400).json({ error: "Nothing to update" });
        }

        const updated = await User.findByIdAndUpdate(
            req.userDoc._id,
            { $set: nextValues },
            { new: true }
        );

        res.json({
            success: true,
            user: {
                id: updated._id,
                firstName: updated.firstName,
                lastName: updated.lastName,
                email: updated.email
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to update profile" });
    }
};
