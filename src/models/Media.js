import mongoose from "mongoose";

const MediaSchema = new mongoose.Schema({
    contractID: { type: mongoose.Schema.Types.ObjectId, ref: "Contract", required: true },
    who:         { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content:     { type: String, required: true }   // URL to file

}, { timestamps: true });

export default mongoose.model("Media", MediaSchema);
