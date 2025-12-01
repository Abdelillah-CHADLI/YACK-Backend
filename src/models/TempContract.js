import mongoose from "mongoose";

const TempContractSchema = new mongoose.Schema({
    userA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    userASign: { type: Boolean, default: false },
    userBSign: { type: Boolean, default: false },

    hash: { type: String, default: "" },

}, { timestamps: true });

export default mongoose.model("TempContract", TempContractSchema);
