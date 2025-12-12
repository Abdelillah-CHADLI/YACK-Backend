import { MediaHandler } from "../utils/mediaHandler.js";
import Contract from "../models/Contract.js";
import { sendNotification } from "../utils/sendNotification.js";

export const sendMedia = async (req, res) => {
    try {
        const file = req.body?.file;
        if (!file || !file.filename || !file.buffer) {
            return res.status(400).json({ error: "Media payload required" });
        }

        const stored = await MediaHandler.send(file);
        const contract = req.contract;

        const entry = {
            who: req.userDoc._id,
            content: stored.path
        };

        contract.media.push(entry);
        await contract.save();

        const otherUser = req.isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            const preview = file.filename || stored.path.split("/").pop();
            await sendNotification(
                otherUser,
                "New Media",
                `${req.userDoc.firstName} shared ${preview}`,
                {
                    type: "contractMedia",
                    contractId: contract._id.toString(),
                    mediaPath: stored.path
                }
            );
        }

        res.json({ success: true, media: contract.media.at(-1) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to send media" });
    }
};

export const getAllMedia = async (req, res) => {
    try {
        const contract = await Contract.findById(req.contract._id)
            .select("media")
            .populate("media.who", "firstName lastName");

        res.json({ success: true, media: contract.media });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch media" });
    }
};
