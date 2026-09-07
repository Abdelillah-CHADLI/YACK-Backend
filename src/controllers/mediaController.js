import mongoose from "mongoose";
import Contract from "../models/Contract.js";
import {
    MediaConfigurationError,
    MediaHandler,
    MediaValidationError,
} from "../utils/mediaHandler.js";
import { sendNotification } from "../utils/sendNotification.js";

function mediaErrorResponse(res, error, fallback) {
    if (error instanceof MediaValidationError || error instanceof MediaConfigurationError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    console.error(`[media] ${fallback}:`, error.message);
    return res.status(500).json({ error: fallback });
}

export const sendMedia = async (req, res) => {
    let stored;
    let persisted = false;

    try {
        stored = await MediaHandler.send(req.body?.file);

        const createdAt = new Date();
        const entry = {
            _id: new mongoose.Types.ObjectId(),
            who: req.userDoc._id,
            content: stored.path,
            url: stored.url,
            originalFilename: stored.originalFilename,
            mimeType: stored.mimeType,
            createdAt,
        };

        // Atomically append so simultaneous uploads/messages cannot overwrite
        // each other's embedded-array changes.
        const updated = await Contract.findOneAndUpdate(
            {
                _id: req.contract._id,
                $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }],
            },
            { $push: { media: entry } },
            { new: true, runValidators: true, projection: { userA: 1, userB: 1 } }
        );

        if (!updated) {
            await MediaHandler.delete(stored.path).catch(() => undefined);
            return res.status(404).json({ error: "Contract not found" });
        }
        persisted = true;

        res.status(201).json({
            success: true,
            media: {
                ...entry,
                who: {
                    _id: req.userDoc._id,
                    firstName: req.userDoc.firstName,
                    lastName: req.userDoc.lastName,
                },
            },
        });

        const recipientId = req.isUserA ? updated.userB : updated.userA;
        if (recipientId) {
            void sendNotification(
                recipientId,
                "new_media",
                "",
                {
                    type: "contractMedia",
                    contractId: updated._id.toString(),
                    mediaId: entry._id.toString(),
                },
                {
                    localize: true,
                    params: {
                        name: req.userDoc.firstName,
                        filename: stored.originalFilename,
                    },
                }
            );
        }
    } catch (error) {
        if (stored && !persisted) {
            await MediaHandler.delete(stored.path).catch((cleanupError) => {
                console.error("[media] Failed to clean up orphaned upload:", cleanupError.message);
            });
        }
        if (!res.headersSent) {
            mediaErrorResponse(res, error, "Failed to send media");
        }
    }
};

export const getAllMedia = async (req, res) => {
    try {
        const contract = await Contract.findById(req.contract._id)
            .select("media")
            .populate("media.who", "firstName lastName");

        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const media = [...contract.media].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        res.json({ success: true, media });
    } catch (error) {
        console.error("[media] Failed to fetch media:", error.message);
        res.status(500).json({ error: "Failed to fetch media" });
    }
};

export const getMedia = async (req, res) => {
    try {
        const { mediaId } = req.query;
        if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
            return res.status(400).json({ error: "Valid mediaId is required" });
        }

        const mediaEntry = req.contract.media.id(mediaId);
        if (!mediaEntry) {
            return res.status(404).json({ error: "Media not found" });
        }

        // Persisted secure URLs are immediately usable. Only query Cloudinary
        // for older records that predate URL storage.
        const mediaData = mediaEntry.url
            ? { url: mediaEntry.url }
            : await MediaHandler.get(mediaEntry.content);

        res.json({
            success: true,
            media: {
                _id: mediaEntry._id,
                who: mediaEntry.who,
                content: mediaEntry.content,
                url: mediaData.url,
                originalFilename: mediaEntry.originalFilename,
                mimeType: mediaEntry.mimeType,
                createdAt: mediaEntry.createdAt,
            },
        });
    } catch (error) {
        mediaErrorResponse(res, error, "Failed to retrieve media");
    }
};
