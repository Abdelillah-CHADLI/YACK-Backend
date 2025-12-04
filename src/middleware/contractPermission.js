import mongoose from "mongoose";
import Contract from "../models/Contract.js";

export default async function checkContractPermission(req, res, next) {
    try {
        const contractId = req.body?.contractId || req.query?.contractId || req.params?.contractId;
        if (!contractId || !mongoose.Types.ObjectId.isValid(contractId)) {
            return res.status(400).json({ error: "Valid contractId is required" });
        }

        const contract = await Contract.findById(contractId);
        if (!contract) {
            return res.status(404).json({ error: "Contract not found" });
        }

        const uid = req.userDoc._id.toString();
        const isUserA = contract.userA.toString() === uid;
        const isUserB = contract.userB.toString() === uid;

        if (!isUserA && !isUserB) {
            return res.status(403).json({ error: "Not authorized for this contract" });
        }

        req.contract = contract;
        req.isUserA = isUserA;
        req.isUserB = isUserB;

        next();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to verify contract permissions" });
    }
}
