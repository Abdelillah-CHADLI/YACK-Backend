import { MediaHandler } from "../utils/mediaHandler.js";
import Contract from "../models/Contract.js";
import User from "../models/User.js";
import { sendNotification } from "../utils/sendNotification.js";

export const sendMedia = async (req, res) => {
    try {
        const file = req.body?.file;
        if (!file || !file.filename || !file.buffer) {
            return res.status(400).json({ error: "Media payload required" });
        }

        const contract = req.contract;
        
        // Get recipient's public key for encryption
        const recipientId = req.isUserA ? contract.userB : contract.userA;
        const recipient = await User.findById(recipientId).select('publicKey firstName lastName');
        
        if (!recipient || !recipient.publicKey) {
            return res.status(400).json({ error: "Recipient public key not found" });
        }

        // Store encrypted media
        const stored = await MediaHandler.send(file, recipient.publicKey);

        const entry = {
            who: req.userDoc._id,
            content: stored.path,
            encryptedKey: stored.encryptedKey,
            iv: stored.iv,
            authTag: stored.authTag,
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

        // Get encrypted media and metadata
        const mediaData = await MediaHandler.get(mediaEntry.content);

        res.json({
            success: true,
            media: {
                _id: mediaEntry._id,
                encryptedData: mediaData.encryptedData,
                encryptedKey: mediaData.encryptedKey || mediaEntry.encryptedKey,
                iv: mediaData.iv || mediaEntry.iv,
                authTag: mediaData.authTag || mediaEntry.authTag,
                originalFilename: mediaData.originalFilename || mediaEntry.originalFilename,
                mimeType: mediaData.mimeType || mediaEntry.mimeType,
                createdAt: mediaEntry.createdAt
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to retrieve media" });
    }
};
