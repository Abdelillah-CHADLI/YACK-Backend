import mongoose from "mongoose";

import Contract from "../models/Contract.js";
import SupportThread from "../models/SupportThread.js";
import User from "../models/User.js";
import { sendNotification } from "../utils/sendNotification.js";
import { ensureSupportThread } from "./supportController.js";

const HASH_PATTERN = /^[a-f0-9]{64}$/i;
const MAX_CIPHERTEXT_LENGTH = 16_384;
const MAX_RESOLUTION_NOTE_LENGTH = 4_000;

const openDisputeFilter = {
    $or: [
        { disputeState: "open" },
        { status: "disputed", disputeState: { $ne: "resolved" } },
    ],
};

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

function validateEncryptedMessage(body) {
    const contentForUser = String(body?.contentForUser || "").trim();
    const contentForAdmin = String(body?.contentForAdmin || "").trim();
    const contentHash = String(body?.contentHash || "").trim().toLowerCase();
    if (!contentForUser || !contentForAdmin) {
        throw new TypeError("Both encrypted message envelopes are required");
    }
    if (
        contentForUser.length > MAX_CIPHERTEXT_LENGTH
        || contentForAdmin.length > MAX_CIPHERTEXT_LENGTH
    ) {
        throw new RangeError("Encrypted message is too large");
    }
    if (!HASH_PATTERN.test(contentHash)) {
        throw new TypeError("Content hash must be a SHA-256 hex digest");
    }
    return { contentForUser, contentForAdmin, contentHash };
}

export const getAdminIdentity = async (req, res) => {
    return res.json({ success: true, admin: req.adminIdentity });
};

export const getAnalytics = async (req, res) => {
    try {
        const since = new Date();
        since.setUTCDate(since.getUTCDate() - 29);
        since.setUTCHours(0, 0, 0, 0);

        const [
            users,
            completedUsers,
            contracts,
            activeContracts,
            completedContracts,
            openDisputes,
            resolvedDisputes,
            openSupportThreads,
            contractTrend,
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ isComplete: true }),
            Contract.countDocuments(),
            Contract.countDocuments({ status: { $in: ["active", "accepted"] } }),
            Contract.countDocuments({ status: "completed" }),
            Contract.countDocuments(openDisputeFilter),
            Contract.countDocuments({ disputeState: "resolved" }),
            SupportThread.countDocuments({ status: "open" }),
            Contract.aggregate([
                { $match: { createdAt: { $gte: since } } },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
                        },
                        contracts: { $sum: 1 },
                        disputes: {
                            $sum: { $cond: [{ $eq: ["$status", "disputed"] }, 1, 0] },
                        },
                    },
                },
                { $sort: { _id: 1 } },
            ]),
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
                contractTrend: contractTrend.map((day) => ({
                    date: day._id,
                    contracts: day.contracts,
                    disputes: day.disputes,
                })),
            },
        });
    } catch (error) {
        console.error("[admin] Failed to load analytics:", error.message);
        return res.status(500).json({ error: "Failed to load analytics" });
    }
};

export const listDisputes = async (req, res) => {
    const requestedState = req.query.state === "resolved" ? "resolved" : "open";
    const filter = requestedState === "resolved"
        ? { disputeState: "resolved" }
        : openDisputeFilter;

    try {
        const contracts = await Contract.find(filter)
            .populate("userA", "firstName lastName email publicKey")
            .populate("userB", "firstName lastName email publicKey")
            .sort({ updatedAt: -1 })
            .limit(250);
        return res.json({
            success: true,
            disputes: contracts.map(disputeSummary),
        });
    } catch (error) {
        console.error("[admin] Failed to list disputes:", error.message);
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
                media: contract.reviewAccessGrants?.length
                    ? (contract.media || []).map((item) => ({
                        _id: item._id,
                        who: item.who,
                        url: item.url,
                        content: item.content,
                        originalFilename: item.originalFilename,
                        mimeType: item.mimeType,
                        createdAt: item.createdAt,
                    }))
                    : [],
                supportThreads: threads.map((thread) => ({
                    _id: thread._id,
                    user: participant(thread.user),
                    status: thread.status,
                    messages: thread.messages.map(adminSupportMessage),
                    createdAt: thread.createdAt,
                    updatedAt: thread.updatedAt,
                })),
            },
        });
    } catch (error) {
        console.error("[admin] Failed to load dispute:", error.message);
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
        console.error("[admin] Failed to send support message:", error.message);
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
        console.error("[admin] Failed to resolve dispute:", error.message);
        return res.status(500).json({ error: "Failed to resolve dispute" });
    }
};
