import { MediaHandler } from "../utils/mediaHandler.js";
import Contract from "../models/Contract.js";
import { sendNotification } from "../utils/sendNotification.js";

export const sendMedia = async (req, res) => {
    try {
        const file = req.body?.file;
        if (!file || !file.filename || !file.buffer) {
            return res.status(400).json({ error: "Media payload required" });
        }

        const contract = req.contract;
        const recipientId = req.isUserA ? contract.userB : contract.userA;

        // Upload media to Cloudinary (no encryption)
        const stored = await MediaHandler.send(file);

        const entry = {
            who: req.userDoc._id,
            content: stored.path,
            url: stored.url,
            originalFilename: stored.originalFilename,
            mimeType: stored.mimeType
        };

        contract.media.push(entry);
        await contract.save();

        if (recipientId) {
            const preview = stored.originalFilename || stored.path.split("/").pop();
            await sendNotification(
                recipientId,
                "new_media",
                "",
                {
                    type: "contractMedia",
                    contractId: contract._id.toString(),
                    mediaId: contract.media.at(-1)._id.toString()
                },
                {
                    localize: true,
                    params: {
                        name: req.userDoc.firstName,
                        filename: preview
                    }
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

export const getMedia = async (req, res) => {
    try {
        const { mediaId } = req.query;
        
        if (!mediaId) {
            return res.status(400).json({ error: "Media ID required" });
        }

        const contract = req.contract;
        const mediaEntry = contract.media.id(mediaId);
        
        if (!mediaEntry) {
            return res.status(404).json({ error: "Media not found" });
        }

        // Get media details from Cloudinary
        const mediaData = await MediaHandler.get(mediaEntry.content);

        res.json({
            success: true,
            media: {
                _id: mediaEntry._id,
                url: mediaData.url,
                originalFilename: mediaEntry.originalFilename,
                mimeType: mediaEntry.mimeType,
                createdAt: mediaEntry.createdAt
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to retrieve media" });
    }
};
