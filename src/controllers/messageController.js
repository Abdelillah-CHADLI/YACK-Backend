import { sendNotification } from "../utils/sendNotification.js";
import Contract from "../models/Contract.js";

export const sendMessage = async (req, res) => {
    try {
        const { content } = req.body;
        if (!content || typeof content !== "string") {
            return res.status(400).json({ error: "Message content required" });
        }

        const contract = req.contract;
        const entry = {
            who: req.userDoc._id,
            content: content.trim()
        };

        contract.messages.push(entry);
        await contract.save();

        const otherUser = req.isUserA ? contract.userB : contract.userA;
        if (otherUser) {
            await sendNotification(
                otherUser,
                "New Message",
                `${req.userDoc.firstName}: ${content.substring(0, 50)}`,
                {
                    type: "contractMessage",
                    contractId: contract._id.toString()
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
            .select("messages")
            .populate("messages.who", "firstName lastName");

        const sorted = contract.messages
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .slice(-limit);

        res.json({ success: true, messages: sorted });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch messages" });
    }
};

