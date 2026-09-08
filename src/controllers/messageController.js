import mongoose from "mongoose";
import Contract from "../models/Contract.js";
import { sendNotification } from "../utils/sendNotification.js";
import {
    parseMessageLimit,
    validateEncryptedMessage,
} from "../utils/messageValidation.js";
import { arrayBelowCap, MAX_MESSAGES_PER_CONTRACT } from "../utils/quota.js";
import { logger } from "../utils/logger.js";

export const sendMessage = async (req, res) => {
    let validated;
    try {
        validated = validateEncryptedMessage(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        const createdAt = new Date();
        const entry = {
            _id: new mongoose.Types.ObjectId(),
            who: req.userDoc._id,
            ...validated,
            createdAt,
        };

        // Atomic append (races cannot drop concurrent messages) plus an inline
        // cap test: the push only applies while messages stays under the cap,
        // so two simultaneous sends cannot both cross the limit (F-01/F-44).
        const updated = await Contract.findOneAndUpdate(
            {
                _id: req.contract._id,
                $or: [{ userA: req.userDoc._id }, { userB: req.userDoc._id }],
                ...arrayBelowCap("messages", MAX_MESSAGES_PER_CONTRACT),
            },
            { $push: { messages: entry } },
            { new: true, runValidators: true, projection: { userA: 1, userB: 1 } }
        );

        if (!updated) {
            const existing = await Contract.findById(req.contract._id).select("messages");
            if (!existing) {
                return res.status(404).json({ error: "Contract not found" });
            }
            if ((existing.messages || []).length >= MAX_MESSAGES_PER_CONTRACT) {
                return res.status(400).json({
                    error: "Message limit reached for this contract",
                    code: "MESSAGE_COUNT_LIMIT",
                });
            }
            return res.status(409).json({
                error: "Could not append message",
                code: "MESSAGE_APPEND_CONFLICT",
            });
        }

        res.status(201).json({
            success: true,
            message: {
                ...entry,
                who: {
                    _id: req.userDoc._id,
                    firstName: req.userDoc.firstName,
                    lastName: req.userDoc.lastName,
                },
                content: validated.contentForSender,
            },
        });

        const recipientId = req.isUserA ? updated.userB : updated.userA;
        if (recipientId) {
            // Push delivery is deliberately best effort and can never turn a
            // successfully persisted message into a client-visible failure.
            void sendNotification(
                recipientId,
                "new_message",
                "",
                {
                    type: "contractMessage",
                    contractId: updated._id.toString(),
                    messageId: entry._id.toString(),
                },
                {
                    localize: true,
                    params: { name: req.userDoc.firstName },
                }
            );
        }
    } catch (error) {
        logger.error("[messages] Failed to send message:", { error: error.message });
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to send message" });
        }
    }
};

export const getAllMessages = async (req, res) => {
    let limit;
    try {
        limit = parseMessageLimit(req.query.limit);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    try {
        // Slice in MongoDB rather than loading an unbounded embedded array into
        // the API process. The client currently requests the newest page.
        const contract = await Contract.findById(req.contract._id)
            .select({ messages: { $slice: -limit }, userA: 1, userB: 1 })
            .populate("messages.who", "firstName lastName");

        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const userId = req.userDoc._id.toString();
        const messages = [...contract.messages]
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .map((message) => {
                const senderId = message.who?._id?.toString()
                    || message.who?.toString()
                    || "";
                const isSender = senderId === userId;
                return {
                    _id: message._id,
                    who: message.who,
                    content: isSender
                        ? message.contentForSender
                        : message.contentForRecipient,
                    contentHash: message.contentHash,
                    createdAt: message.createdAt,
                };
            });

        res.json({ success: true, messages });
    } catch (error) {
        logger.error("[messages] Failed to fetch messages:", { error: error.message });
        res.status(500).json({ error: "Failed to fetch messages" });
    }
};