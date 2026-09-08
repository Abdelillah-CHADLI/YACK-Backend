import mongoose from "mongoose";

import Contract from "../models/Contract.js";
import SupportThread from "../models/SupportThread.js";
import User from "../models/User.js";
import AdminAuditLog from "../models/AdminAuditLog.js";
import { sendNotification } from "../utils/sendNotification.js";
import { ensureSupportThread } from "./supportController.js";
import { validateCiphertext, validateHash } from "../utils/validation.js";
import { mediaEnvelopeOf } from "../utils/mediaHandler.js";
import { parseLimit, parseOffset } from "../utils/pagination.js";
import { logger } from "../utils/logger.js";

const MAX_RESOLUTION_NOTE_LENGTH = 4_000;

const openDisputeFilter = {
    $or: [
        { disputeState: "open" },
        { status: "disputed", disputeState: { $ne: "resolved" } },
    ],
};

/**
 * Append-only audit record for privileged admin actions (F-47). Fire-and-forget:
 * a failed audit write is logged but never fails the action it records.
 */
function auditAdminAction({ actorId, action, contractId, userId, summary }) {
    return AdminAuditLog.create({
        actorId: String(actorId),
        action,
        contractId: contractId || undefined,
        userId: userId || undefined,
        summary: String(summary || "").slice(0, 500),
    }).catch((error) => {
        logger.error("[admin] Failed to record audit trail:", { error: error.message });
    });
}

function participant(user) {
    if (!user) return null;
    return {
        _id: user._id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        publicKey: user.publicKey || "",
    };
}

function disputeSummary(contract) {
    return {
        _id: contract._id,
        status: contract.status,
        disputeState: contract.disputeState === "resolved" ? "resolved" : "open",
        userA: participant(contract.userA),
        userB: participant(contract.userB),
        disputedUserA: contract.disputedUserA,
        disputedUserB: contract.disputedUserB,
        disputeReasonUserA: contract.disputeReasonUserA,
        disputeReasonUserB: contract.disputeReasonUserB,
        disputeReasonEncryptedUserA: contract.disputeReasonEncryptedUserA,
        disputeReasonEncryptedUserB: contract.disputeReasonEncryptedUserB,
        disputedAtUserA: contract.disputedAtUserA,
        disputedAtUserB: contract.disputedAtUserB,
        reviewAccessGranted: contract.reviewAccessGrants?.length > 0,
        reviewAccessCount: contract.reviewAccessGrants?.length || 0,
        resolutionOutcome: contract.resolutionOutcome,
        resolutionNote: contract.resolutionNote,
        resolvedAt: contract.resolvedAt,
        resolvedBy: contract.resolvedBy,
        createdAt: contract.createdAt,
        updatedAt: contract.updatedAt,
    };
}

function adminSupportMessage(message) {
    return {
        _id: message._id,
        senderType: message.senderType,
        senderEmail: message.senderEmail || "",
        content: message.contentForAdmin,
        contentHash: message.contentHash,
        createdAt: message.createdAt,
    };
}

/** F-41: admin support replies use the same shared ciphertext/hash validators. */
function validateEncryptedMessage(body) {
    const contentForUser = validateCiphertext(body?.contentForUser, "Encrypted content for user");
    const contentForAdmin = validateCiphertext(body?.contentForAdmin, "Encrypted content for admin");
    const contentHash = validateHash(body?.contentHash, { label: "Content hash" });
    return { contentForUser, contentForAdmin, contentHash };
}

export const getAdminIdentity = async (req, res) => {
    return res.json({ success: true, admin: req.adminIdentity });
};

export const getAnalytics = async (req, res) => {
    try {
        const [
            users,
            completedUsers,
            contracts,
            activeContracts,
            completedContracts,
            openDisputes,
            resolvedDisputes,
            openSupportThreads,
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isComplete: true }),
            Contract.countDocuments(),
            Contract.countDocuments({ status: { $in: ["active", "accepted"] } }),
            Contract.countDocuments({ status: "completed" }),
            Contract.countDocuments(openDisputeFilter),
            Contract.countDocuments({ disputeState: "resolved" }),
            SupportThread.countDocuments({ status: "open" }),
        ]);

        return res.json({
            success: true,
            analytics: {
                users,
                completedUsers,
                contracts,
                activeContracts,
                completedContracts,
                openDisputes,
                resolvedDisputes,
                openSupportThreads,
            },
        });
    } catch (error) {
        logger.error("[admin] Failed to load analytics:", { error: error.message });
        return res.status(500).json({ error: "Failed to load analytics" });
    }
};

export const listDisputes = async (req, res) => {
    // F-14: bounded pages for the dispute queue (default mirrors the previous
    // 250 hard cap; the admin UI can page through by offset).
    const limit = parseLimit(req.query.limit, { defaultValue: 250, max: 250 });
    const offset = parseOffset(req.query.offset, { defaultValue: 0 });

    const requestedState = req.query.state === "resolved" ? "resolved" : "open";
    const filter = requestedState === "resolved"
        ? { disputeState: "resolved" }
        : openDisputeFilter;

    try {
        const [total, contracts] = await Promise.all([
            Contract.countDocuments(filter),
            Contract.find(filter)
                .populate("userA", "firstName lastName email publicKey")
                .populate("userB", "firstName lastName email publicKey")
                .sort({ updatedAt: -1 })
                .skip(offset)
                .limit(limit),
        ]);
        return res.json({
            success: true,
            disputes: contracts.map(disputeSummary),
            pagination: {
                total,
                limit,
                offset,
                hasMore: offset + contracts.length < total,
            },
        });
    } catch (error) {
        logger.error("[admin] Failed to list disputes:", { error: error.message });
        return res.status(500).json({ error: "Failed to list disputes" });
    }
};

export const getDispute = async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.contractId)) {
        return res.status(400).json({ error: "Invalid contract ID" });
    }

    try {
        const contract = await Contract.findById(req.params.contractId)
            .populate("userA", "firstName lastName email publicKey")
            .populate("userB", "firstName lastName email publicKey")
            .populate("reviewAccessGrants.grantedBy", "firstName lastName email");
        if (!contract || (!contract.disputedUserA && !contract.disputedUserB)) {
            return res.status(404).json({ error: "Dispute not found" });
        }

        auditAdminAction({
            actorId: req.adminIdentity.uid,
            action: "dispute.viewed",
            contractId: contract._id,
            summary: `Threads: ${(contract.reviewAccessGrants || []).length} grant(s)`,
        });

        const participants = [
            contract.userA?._id,
            contract.userB?._id,
        ].filter(Boolean);
        await Promise.all(
            participants.map((userId) => ensureSupportThread(contract._id, userId))
        );

        const threads = await SupportThread.find({ contract: contract._id })
            .populate("user", "firstName lastName email publicKey")
            .sort({ updatedAt: -1 });

        // F-55: support-thread attachments may contain party-to-party media;
        // the app's contract-scoped review grant is what authorizes admin
        // (re)view of the dispute, so without a grant nothing is disclosed.
        const grantAuthorized = (contract.reviewAccessGrants || []).length > 0;

        return res.json({
            success: true,
            dispute: {
                ...disputeSummary(contract),
                detailsHash: contract.detailsHash,
                reviewAccessGrants: (contract.reviewAccessGrants || []).map((grant) => ({
                    _id: grant._id,
                    grantedBy: participant(grant.grantedBy),
                    title: grant.titleForAdmin,
                    description: grant.descriptionForAdmin,
                    price: grant.priceForAdmin,
                    messages: grant.messages,
                    grantedAt: grant.grantedAt,
                })),
                // Existing attachments use the app's current Cloudinary URL
                // format, so never disclose them to an admin before a disputing
                // user explicitly grants contract-scoped review access.
                media: grantAuthorized
                    ? (contract.media || []).map((item) => ({
                        _id: item._id,
                        who: item.who,
                        url: item.url,
                        content: item.content,
                        originalFilename: item.originalFilename,
                        mimeType: item.mimeType,
                        size: item.size || 0,
                        ...mediaEnvelopeOf(item),
                        createdAt: item.createdAt,
                    }))
                    : [],
                supportThreads: threads.map((thread) => ({
                    _id: thread._id,
                    user: participant(thread.user),
                    status: thread.status,
                    messages: thread.messages.map(adminSupportMessage),
                    attachments: grantAuthorized
                        ? (thread.attachments || []).map((attachment) => ({
                            _id: attachment._id,
                            url: attachment.url,
                            originalFilename: attachment.originalFilename,
                            mimeType: attachment.mimeType,
                            size: attachment.size || 0,
                            ...mediaEnvelopeOf(attachment),
                            createdAt: attachment.createdAt,
                        }))
                        : [],
                    createdAt: thread.createdAt,
                    updatedAt: thread.updatedAt,
                })),
            },
        });
    } catch (error) {
        logger.error("[admin] Failed to load dispute:", { error: error.message });
        return res.status(500).json({ error: "Failed to load dispute" });
    }
};

export const sendAdminSupportMessage = async (req, res) => {
    const { contractId, userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contractId) || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "Invalid contract or user ID" });
    }

    let encrypted;
    try {
        encrypted = validateEncryptedMessage(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const entry = {
        _id: new mongoose.Types.ObjectId(),
        senderType: "admin",
        senderEmail: req.adminIdentity.email,
        ...encrypted,
        createdAt: new Date(),
    };

    try {
        const thread = await SupportThread.findOneAndUpdate(
            { contract: contractId, user: userId, status: "open" },
            { $push: { messages: entry } },
            { new: true, runValidators: true }
        );
        if (!thread) {
            return res.status(404).json({ error: "Open support conversation not found" });
        }

        auditAdminAction({
            actorId: req.adminIdentity.uid,
            action: "support.message.sent",
            contractId,
            userId,
        });

        void sendNotification(
            userId,
            "YACK Support",
            "You have a new message about your dispute.",
            { type: "supportMessage", contractId, threadId: thread._id.toString() }
        );

        return res.status(201).json({
            success: true,
            message: adminSupportMessage(entry),
        });
    } catch (error) {
        logger.error("[admin] Failed to send support message:", { error: error.message });
        return res.status(500).json({ error: "Failed to send support message" });
    }
};

export const resolveDispute = async (req, res) => {
    const { contractId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(contractId)) {
        return res.status(400).json({ error: "Invalid contract ID" });
    }

    const outcome = String(req.body?.outcome || "");
    if (!["resume", "complete", "cancel"].includes(outcome)) {
        return res.status(400).json({ error: "Outcome must be resume, complete, or cancel" });
    }
    const note = String(req.body?.note || "").trim();
    if (!note || note.length > MAX_RESOLUTION_NOTE_LENGTH) {
        return res.status(400).json({ error: "A resolution note is required" });
    }

    try {
        const current = await Contract.findById(contractId);
        if (!current || current.status !== "disputed" || current.disputeState === "resolved") {
            return res.status(409).json({ error: "This dispute is no longer open" });
        }

        const resumedStatus = ["pending", "active", "accepted"].includes(
            current.statusBeforeDispute
        ) ? current.statusBeforeDispute : "active";
        const nextStatus = outcome === "complete"
            ? "completed"
            : outcome === "cancel"
                ? "rejected"
                : resumedStatus;

        const updated = await Contract.findOneAndUpdate(
            { _id: current._id, status: "disputed", disputeState: { $ne: "resolved" } },
            {
                $set: {
                    status: nextStatus,
                    disputeState: "resolved",
                    resolutionOutcome: outcome,
                    resolutionNote: note,
                    resolvedAt: new Date(),
                    resolvedBy: req.adminIdentity.email,
                },
            },
            { new: true, runValidators: true }
        );
        if (!updated) {
            return res.status(409).json({ error: "The dispute changed before it was resolved" });
        }

        await SupportThread.updateMany(
            { contract: current._id, status: "open" },
            { $set: { status: "closed" } }
        );

        auditAdminAction({
            actorId: req.adminIdentity.uid,
            action: "dispute.resolved",
            contractId: current._id,
            summary: `Outcome: ${outcome}${note ? ` — ${note}` : ""}`,
        });

        for (const userId of [current.userA, current.userB]) {
            void sendNotification(
                userId,
                "YACK Support",
                "A decision has been recorded for your disputed contract.",
                { type: "disputeResolved", contractId, outcome }
            );
        }

        return res.json({
            success: true,
            dispute: disputeSummary(updated),
        });
    } catch (error) {
        logger.error("[admin] Failed to resolve dispute:", { error: error.message });
        return res.status(500).json({ error: "Failed to resolve dispute" });
    }
};