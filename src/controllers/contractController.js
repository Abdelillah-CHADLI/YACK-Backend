// src/controllers/contractController.js

import TempContract from "../models/TempContract.js";
import Contract from "../models/Contract.js";
import { sendNotification } from "../utils/sendNotification.js";

/**
 * Create temporary contract
 */
export const createContract = async (req, res) => {
    try {
        const { hash } = req.body;

        const temp = await TempContract.create({
            userA: req.userDoc._id,
            hash: hash || ""
        });

        res.json({ success: true, tempID: temp._id });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create temp contract" });
    }
};


/**
 * Join temporary contract
 */
export const joinContract = async (req, res) => {
    try {
        const { tempID } = req.body;

        const temp = await TempContract.findById(tempID);
        if (!temp) return res.status(404).json({ error: "Temp contract not found" });

        if (temp.userB)
            return res.status(400).json({ error: "Contract already joined" });

        temp.userB = req.userDoc._id;
        await temp.save();

        // notify userA
        sendNotification(temp.userA, "Contract Update", `${req.userDoc.firstName} joined your contract.`);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to join contract" });
    }
};


/**
 * Sign temporary contract
 */
export const signContract = async (req, res) => {
    try {
        const { tempID } = req.body;

        const temp = await TempContract.findById(tempID);
        if (!temp) return res.status(404).json({ error: "Temp contract not found" });

        const uid = req.userDoc._id.toString();

        if (uid === temp.userA?.toString()) {
            temp.userASign = true;
        } else if (uid === temp.userB?.toString()) {
            temp.userBSign = true;
        } else {
            return res.status(403).json({ error: "Not your contract" });
        }

        await temp.save();

        // notify other user
        const other = uid === temp.userA?.toString() ? temp.userB : temp.userA;
        if (other) sendNotification(other, "Contract Update", "The other user signed.");

        // if both signed => finalize
        if (temp.userASign && temp.userBSign) {
            const final = await Contract.create({
                userA: temp.userA,
                userB: temp.userB,
                userASign: true,
                userBSign: true,
                status: "active"
            });

            await temp.deleteOne();

            return res.json({
                success: true,
                completed: true,
                contractID: final._id
            });
        }

        res.json({ success: true, signed: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to sign contract" });
    }
};
