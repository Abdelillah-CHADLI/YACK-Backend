import mongoose from "mongoose";

const MediaSchema = new mongoose.Schema({
    contractID: { type: mongoose.Schema.Types.ObjectId, ref: "Contract", required: true },
    who: { type: String, required: true },
    content: { type: String, required: true }, // file URL
}, { timestamps: true });

export default mongoose.model("Media", MediaSchema);
