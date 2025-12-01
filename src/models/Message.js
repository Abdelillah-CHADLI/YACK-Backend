import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema({
    contractID: { type: mongoose.Schema.Types.ObjectId, ref: "Contract", required: true },
    who:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content:     { type: String, required: true }

}, { timestamps: true });

export default mongoose.model("Message", MessageSchema);
