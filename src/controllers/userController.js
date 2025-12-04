import User from "../models/User.js";


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
