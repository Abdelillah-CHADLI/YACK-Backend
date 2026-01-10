import { sendNotification } from "../utils/sendNotification.js";
import Contract from "../models/Contract.js";

export const sendMessage = async (req, res) => {
    try {
        const { contentForSender, contentForRecipient, contentHash } = req.body;

        // Validate encrypted content fields
        if (!contentForSender || typeof contentForSender !== "string") {
            return res.status(400).json({ error: "Encrypted content for sender required" });
        }
        if (!contentForRecipient || typeof contentForRecipient !== "string") {
            return res.status(400).json({ error: "Encrypted content for recipient required" });
        }
        if (!contentHash || typeof contentHash !== "string") {
            return res.status(400).json({ error: "Content hash required" });
        }

        const contract = req.contract;
        const entry = {
            who: req.userDoc._id,
            contentForSender: contentForSender.trim(),
            contentForRecipient: contentForRecipient.trim(),
            contentHash: contentHash.trim()
        };

        contract.messages.push(entry);
        await contract.save();

        const otherUser = req.isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            await sendNotification(
                otherUser,
                "new_message",
                "",
                {
                    type: "contractMessage",
                    contractId: contract._id.toString()
                },
                {
                    localize: true,
                    params: {
                        name: req.userDoc.firstName
                    }
                }
            );
        }

        res.json({ success: true, message: contract.messages.at(-1) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to send message" });
    }
};

export const getAllMessages = async (req, res) => {
    try {
        const limit = Number(req.query.limit) || 50;
        const contract = await Contract.findById(req.contract._id)
            .select("messages userA userB")
            .populate("messages.who", "firstName lastName");

        const userId = req.userDoc._id.toString();

        // Map messages to return only the caller's encrypted version
        const sorted = contract.messages
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .slice(-limit)
            .map(msg => {
                const isSender = msg.who._id.toString() === userId;
                return {
                    _id: msg._id,
                    who: msg.who,
                    content: isSender ? msg.contentForSender : msg.contentForRecipient,
                    contentHash: msg.contentHash,
                    createdAt: msg.createdAt
                };
            });

        res.json({ success: true, messages: sorted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
};

