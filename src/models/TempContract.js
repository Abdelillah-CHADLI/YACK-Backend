import mongoose from "mongoose";

const TempContractSchema = new mongoose.Schema({
    userA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    userASign: { type: Boolean, default: false },
    userBSign: { type: Boolean, default: false },

    hash: { type: String, default: "" },

    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from creation
        index: { expires: 0 } // TTL index
    }

}, { timestamps: true });

export default mongoose.model("TempContract", TempContractSchema);
