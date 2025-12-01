import mongoose from "mongoose";

const ContractSchema = new mongoose.Schema({
    userA: { type: String, required: true },
    userB: { type: String, required: true },

    userASign: { type: Boolean, default: true },
    userBSign: { type: Boolean, default: true },

    status: {
        type: String,
        enum: ["active", "completed", "cancelled"],
        default: "active"
    },

    agreedUserA: { type: Boolean, default: false },
    agreedUserB: { type: Boolean, default: false },
    disputedUserA: { type: Boolean, default: false },
    disputedUserB: { type: Boolean, default: false },

}, { timestamps: true });

export default mongoose.model("Contract", ContractSchema);
