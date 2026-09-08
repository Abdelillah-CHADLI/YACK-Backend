import mongoose from "mongoose";

const SupportMessageSchema = new mongoose.Schema({
    senderType: {
        type: String,
        enum: ["user", "admin"],
        required: true,
    },
    senderUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
    senderEmail: { type: String, default: "" },
    contentForUser: { type: String, required: true },
    contentForAdmin: { type: String, required: true },
    contentHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { _id: true });

const SupportAttachmentSchema = new mongoose.Schema({
    who: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    content: { type: String, required: true },  // Cloudinary public_id
    url: { type: String, default: "" },  // Cloudinary secure URL
    originalFilename: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
}, { _id: true });

const SupportThreadSchema = new mongoose.Schema({
    contract: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Contract",
        required: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    status: {
        type: String,
        enum: ["open", "closed"],
        default: "open",
    },
    messages: [SupportMessageSchema],
    attachments: [SupportAttachmentSchema],
}, { timestamps: true });

SupportThreadSchema.index({ contract: 1, user: 1 }, { unique: true });
SupportThreadSchema.index({ status: 1, updatedAt: -1 });

export default mongoose.model("SupportThread", SupportThreadSchema);
