import mongoose from "mongoose";

const EmbeddedMessageSchema = new mongoose.Schema({
    who:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const EmbeddedMediaSchema = new mongoose.Schema({
    who:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

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

    hash: { type: String, default: "" },

    messages: [EmbeddedMessageSchema],
    media:    [EmbeddedMediaSchema]

}, { timestamps: true });

export default mongoose.model("Contract", ContractSchema);
