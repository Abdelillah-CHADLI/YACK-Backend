import mongoose from "mongoose";

const EmbeddedMessageSchema = new mongoose.Schema({
    who:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    contentForSender:    { type: String, required: true },   // encrypted with sender's public key
    contentForRecipient: { type: String, required: true },   // encrypted with recipient's public key
    contentHash:         { type: String, required: true },   // SHA hash for verification
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const EmbeddedMediaSchema = new mongoose.Schema({
    who:     { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },  // Path to encrypted file in Firebase Storage
    url: { type: String, default: "" },  // Firebase Storage signed URL
    encryptedKey: { type: String, default: "" },  // RSA-encrypted AES key (base64)
    iv: { type: String, default: "" },  // Initialization vector (base64)
    authTag: { type: String, default: "" },  // GCM authentication tag (base64)
    originalFilename: { type: String, default: "" },  // Original filename
    mimeType: { type: String, default: "" },  // MIME type
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

    // Encrypted contract details for userA
    titleUserA:       { type: String, default: "" },
    descriptionUserA: { type: String, default: "" },
    priceUserA:       { type: String, default: "" },

    // Encrypted contract details for userB
    titleUserB:       { type: String, default: "" },
    descriptionUserB: { type: String, default: "" },
    priceUserB:       { type: String, default: "" },

    // SHA hash of title + description + price combined for verification
    detailsHash: { type: String, default: "" },

    agreedUserA:    { type: Boolean, default: false },
    agreedUserB:    { type: Boolean, default: false },
    disputedUserA:  { type: Boolean, default: false },
    disputedUserB:  { type: Boolean, default: false },

    hash: { type: String, default: "" },

    messages: [EmbeddedMessageSchema],
    media:    [EmbeddedMediaSchema]

}, { timestamps: true });

export default mongoose.model("Contract", ContractSchema);
