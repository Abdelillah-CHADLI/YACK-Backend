import mongoose from "mongoose";

const ContractSchema = new mongoose.Schema({
    userA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    userASign: { type: Boolean, default: true },
    userBSign: { type: Boolean, default: true },

    status: {
        type: String,
        enum: ["active", "completed", "pending" , "dispatched"],
        default: "active"
    },

    agreedUserA:    { type: Boolean, default: false },
    agreedUserB:    { type: Boolean, default: false },
    disputedUserA:  { type: Boolean, default: false },
    disputedUserB:  { type: Boolean, default: false },

}, { timestamps: true });

export default mongoose.model("Contract", ContractSchema);
