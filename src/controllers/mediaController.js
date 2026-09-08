import mongoose from "mongoose";
import Contract from "../models/Contract.js";
import {
    MediaConfigurationError,
    MediaHandler,
    MediaValidationError,
} from "../utils/mediaHandler.js";
import { sendNotification } from "../utils/sendNotification.js";
import { arrayBelowCap, MAX_MEDIA_PER_CONTRACT } from "../utils/quota.js";
import { parseLimit, parseOffset } from "../utils/pagination.js";
import { logger } from "../utils/logger.js";

function mediaErrorResponse(res, error, fallback) {
    if (error instanceof MediaValidationError || error instanceof MediaConfigurationError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error(`[media] ${fallback}:`, { error: error.message });
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

        // Atomically append (races cannot overwrite embedded-array changes) with
        // an inline cap test so concurrent uploads cannot both exceed the limit
        // (F-01/F-45). The Cloudinary artifact is only kept once this write wins.
        const updated = await Contract.findOneAndUpdate(
            {
                _id: req.contract._id,
                $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }],
                ...arrayBelowCap("media", MAX_MEDIA_PER_CONTRACT),
            },
            { $push: { media: entry } },
            { new: true, runValidators: true, projection: { userA: 1, userB: 1 } }
        );

        if (!updated) {
            await MediaHandler.delete(stored.path).catch(() => undefined);
            const existing = await Contract.findById(req.contract._id).select("media");
            if (!existing) {
                return res.status(404).json({ error: "Contract not found" });
            }
            if ((existing.media || []).length >= MAX_MEDIA_PER_CONTRACT) {
                return res.status(400).json({
                    error: "Media limit reached for this contract",
                    code: "MEDIA_QUOTA_EXCEEDED",
                });
            }
            return res.status(409).json({
                error: "Could not attach media",
                code: "MEDIA_APPEND_CONFLICT",
            });
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
            // F-30: the media id alone was useless to a client that lost the
            // push; include the storage path so the thread can be hydrated
            // without re-fetching by id.
            void sendNotification(
                recipientId,
                "new_media",
                "",
                {
                    type: "contractMedia",
                    contractId: updated._id.toString(),
                    mediaId: entry._id.toString(),
                    mediaPath: stored.path.slice(0, 250),
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
                logger.error("[media] Failed to clean up orphaned upload:", {
                    error: cleanupError.message,
                });
            });
        }
        if (!res.headersSent) {
            mediaErrorResponse(res, error, "Failed to send media");
        }
    }
};

export const getAllMedia = async (req, res) => {
    // F-14: bounded pagination instead of an unbounded embedded array.
    const limit = parseLimit(req.query.limit, { defaultValue: 100, max: 100 });
    const offset = parseOffset(req.query.offset, { defaultValue: 0 });

    try {
        const [totalResult] = await Contract.aggregate([
            { $match: { _id: req.contract._id } },
            { $project: { total: { $size: { $ifNull: ["$media", []] } } } },
        ]);

        if (!totalResult) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const contract = await Contract.findById(req.contract._id)
            .select({ media: { $slice: [offset, limit] } })
            .populate("media.who", "firstName lastName");

        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const media = [...contract.media].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        res.json({
            success: true,
            media,
            pagination: {
                total: totalResult.total,
                limit,
                offset,
                hasMore: offset + media.length < totalResult.total,
            },
        });
    } catch (error) {
        logger.error("[media] Failed to fetch media:", { error: error.message });
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