import mongoose from "mongoose";

import Contract from "../models/Contract.js";
import SupportThread from "../models/SupportThread.js";
import {
    MediaConfigurationError,
    MediaHandler,
    MediaValidationError,
} from "../utils/mediaHandler.js";

const MAX_CIPHERTEXT_LENGTH = 16_384;
const MAX_REVIEW_MESSAGES = 250;
const MAX_SUPPORT_ATTACHMENTS = 25;
const HASH_PATTERN = /^[a-f0-9]{64}$/i;

function requiredCiphertext(value, label) {
    if (typeof value !== "string" || !value.trim()) {
        throw new TypeError(`${label} is required`);
    }
    const normalized = value.trim();
    if (normalized.length > MAX_CIPHERTEXT_LENGTH) {
        throw new RangeError(`${label} is too large`);
    }
    return normalized;
}

function requiredHash(value) {
    const hash = String(value || "").trim().toLowerCase();
    if (!HASH_PATTERN.test(hash)) {
        throw new TypeError("Content hash must be a SHA-256 hex digest");
    }
    return hash;
}

function callerInDispute(req) {
    return req.contract.status === "disputed";
}

function userMessagePayload(message) {
    return {
        _id: message._id,
        senderType: message.senderType,
        content: message.contentForUser,
        contentHash: message.contentHash,
        createdAt: message.createdAt,
    };
}

function supportAttachmentPayload(attachment) {
    return {
        _id: attachment._id,
        who: attachment.who,
        content: attachment.content,
        url: attachment.url,
        originalFilename: attachment.originalFilename,
        mimeType: attachment.mimeType,
        size: attachment.size || 0,
        createdAt: attachment.createdAt,
    };
}

export async function ensureSupportThread(contractId, userId) {
    return SupportThread.findOneAndUpdate(
        { contract: contractId, user: userId },
        { $set: { status: "open" } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
}

export const getReviewPublicKey = async (req, res) => {
    const publicKey = String(process.env.ADMIN_REVIEW_PUBLIC_KEY || "").trim();
    if (!publicKey) {
        return res.status(503).json({
            error: "Support review encryption is not configured",
            code: "REVIEW_KEY_UNAVAILABLE",
        });
    }
    return res.json({ success: true, publicKey });
};

export const grantReviewAccess = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({
            error: "Only parties involved in this dispute can access its support case",
            code: "DISPUTE_ACCESS_NOT_ALLOWED",
        });
    }

    let grant;
    try {
        const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
        if (messages.length > MAX_REVIEW_MESSAGES) {
            return res.status(400).json({ error: "Too many review messages" });
        }

        grant = {
            grantedBy: req.userDoc._id,
            titleForAdmin: requiredCiphertext(req.body?.titleForAdmin, "Encrypted title"),
            descriptionForAdmin: requiredCiphertext(
                req.body?.descriptionForAdmin,
                "Encrypted description"
            ),
            priceForAdmin: requiredCiphertext(req.body?.priceForAdmin, "Encrypted price"),
            messages: messages.map((message) => ({
                sourceMessageId: String(message?.sourceMessageId || "").slice(0, 128),
                senderId: String(message?.senderId || "").slice(0, 128),
                senderName: String(message?.senderName || "").trim().slice(0, 160),
                contentForAdmin: requiredCiphertext(
                    message?.contentForAdmin,
                    "Encrypted review message"
                ),
                contentHash: message?.contentHash
                    ? requiredHash(message.contentHash)
                    : "",
                createdAt: message?.createdAt ? new Date(message.createdAt) : new Date(),
            })),
            grantedAt: new Date(),
        };
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    if (grant.messages.some((message) => Number.isNaN(message.createdAt.getTime()))) {
        return res.status(400).json({ error: "Invalid review message timestamp" });
    }

    try {
        let updated = await Contract.findOneAndUpdate(
            {
                _id: req.contract._id,
                status: "disputed",
                "reviewAccessGrants.grantedBy": req.userDoc._id,
            },
            { $set: { "reviewAccessGrants.$": grant } },
            { new: true, runValidators: true }
        );
        if (!updated) {
            updated = await Contract.findOneAndUpdate(
                {
                    _id: req.contract._id,
                    status: "disputed",
                    "reviewAccessGrants.grantedBy": { $ne: req.userDoc._id },
                },
                { $push: { reviewAccessGrants: grant } },
                { new: true, runValidators: true }
            );
        }
        if (!updated) {
            return res.status(409).json({ error: "The dispute is no longer open" });
        }

        await ensureSupportThread(req.contract._id, req.userDoc._id);
        return res.json({ success: true, grantedAt: grant.grantedAt });
    } catch (error) {
        console.error("[support] Failed to grant review access:", error.message);
        return res.status(500).json({ error: "Failed to grant review access" });
    }
};

export const getUserSupportThread = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({ error: "No support case exists for this user" });
    }

    try {
        const thread = await ensureSupportThread(req.contract._id, req.userDoc._id);
        return res.json({
            success: true,
            thread: {
                _id: thread._id,
                contractId: thread.contract,
                status: thread.status,
                reviewAccessGranted: (req.contract.reviewAccessGrants || []).some(
                    (grant) => grant.grantedBy.toString() === req.userDoc._id.toString()
                ),
                messages: thread.messages.map(userMessagePayload),
                attachments: (thread.attachments || []).map(supportAttachmentPayload),
                createdAt: thread.createdAt,
                updatedAt: thread.updatedAt,
            },
        });
    } catch (error) {
        console.error("[support] Failed to load support thread:", error.message);
        return res.status(500).json({ error: "Failed to load support conversation" });
    }
};

export const sendUserSupportMessage = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({ error: "No support case exists for this user" });
    }

    let entry;
    try {
        entry = {
            _id: new mongoose.Types.ObjectId(),
            senderType: "user",
            senderUser: req.userDoc._id,
            contentForUser: requiredCiphertext(req.body?.contentForUser, "User ciphertext"),
            contentForAdmin: requiredCiphertext(req.body?.contentForAdmin, "Admin ciphertext"),
            contentHash: requiredHash(req.body?.contentHash),
            createdAt: new Date(),
        };
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        await ensureSupportThread(req.contract._id, req.userDoc._id);
        const thread = await SupportThread.findOneAndUpdate(
            { contract: req.contract._id, user: req.userDoc._id, status: "open" },
            { $push: { messages: entry } },
            { new: true, runValidators: true }
        );
        if (!thread) {
            return res.status(409).json({ error: "This support conversation is closed" });
        }
        return res.status(201).json({ success: true, message: userMessagePayload(entry) });
    } catch (error) {
        console.error("[support] Failed to send support message:", error.message);
        return res.status(500).json({ error: "Failed to send support message" });
    }
};

export const uploadSupportAttachment = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({ error: "No support case exists for this user" });
    }

    let stored;
    let persisted = false;
    try {
        const thread = await ensureSupportThread(req.contract._id, req.userDoc._id);
        if (!thread || thread.status !== "open") {
            return res.status(409).json({ error: "This support conversation is closed" });
        }
        if ((thread.attachments || []).length >= MAX_SUPPORT_ATTACHMENTS) {
            return res.status(400).json({ error: "Too many support attachments" });
        }

        stored = await MediaHandler.send(req.body?.file);
        const entry = {
            _id: new mongoose.Types.ObjectId(),
            who: req.userDoc._id,
            content: stored.path,
            url: stored.url,
            originalFilename: stored.originalFilename,
            mimeType: stored.mimeType,
            size: stored.size || 0,
            createdAt: new Date(),
        };

        const updated = await SupportThread.findOneAndUpdate(
            { contract: req.contract._id, user: req.userDoc._id, status: "open" },
            { $push: { attachments: entry } },
            { new: true, runValidators: true }
        );
        if (!updated) {
            await MediaHandler.delete(stored.path).catch(() => undefined);
            return res.status(409).json({ error: "This support conversation is closed" });
        }
        persisted = true;
        return res.status(201).json({ success: true, attachment: supportAttachmentPayload(entry) });
    } catch (error) {
        if (stored && !persisted) {
            await MediaHandler.delete(stored.path).catch(() => undefined);
        }
        if (error instanceof MediaValidationError || error instanceof MediaConfigurationError) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        console.error("[support] Failed to upload support attachment:", error.message);
        return res.status(500).json({ error: "Failed to upload support attachment" });
    }
};

export const getSupportAttachments = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({ error: "No support case exists for this user" });
    }

    try {
        const thread = await ensureSupportThread(req.contract._id, req.userDoc._id);
        const attachments = [...(thread.attachments || [])].sort(
            (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
        );
        return res.json({
            success: true,
            attachments: attachments.map(supportAttachmentPayload),
        });
    } catch (error) {
        console.error("[support] Failed to load support attachments:", error.message);
        return res.status(500).json({ error: "Failed to load support attachments" });
    }
};

export const deleteSupportAttachment = async (req, res) => {
    if (!callerInDispute(req)) {
        return res.status(403).json({ error: "No support case exists for this user" });
    }

    const { mediaId } = req.params;
    if (!mediaId || !mongoose.Types.ObjectId.isValid(mediaId)) {
        return res.status(400).json({ error: "Invalid attachment ID" });
    }

    try {
        const thread = await SupportThread.findOne({
            contract: req.contract._id,
            user: req.userDoc._id,
            status: "open",
            "attachments._id": mediaId,
        });
        const attachment = thread?.attachments.id(mediaId);
        if (!attachment || attachment.who.toString() !== req.userDoc._id.toString()) {
            return res.status(404).json({ error: "Attachment not found" });
        }

        await SupportThread.updateOne(
            { contract: req.contract._id, user: req.userDoc._id, status: "open" },
            { $pull: { attachments: { _id: mediaId } } }
        );
        if (attachment.content) {
            await MediaHandler.delete(attachment.content).catch(() => undefined);
        }
        return res.json({ success: true });
    } catch (error) {
        console.error("[support] Failed to delete support attachment:", error.message);
        return res.status(500).json({ error: "Failed to delete support attachment" });
    }
};
