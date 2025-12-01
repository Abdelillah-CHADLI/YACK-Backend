import mongoose from "mongoose";

const TempContractSchema = new mongoose.Schema({
    userA: { type: String, required: true }, // UID from Firebase
    userB: { type: String, default: null },
    userASign: { type: Boolean, default: false },
    userBSign: { type: Boolean, default: false },
    hash: { type: String }, // not used for now

}, { timestamps: true });

export default mongoose.model("TempContract", TempContractSchema);
