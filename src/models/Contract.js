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
    content: { type: String, required: true },  // Cloudinary public_id
    url: { type: String, default: "" },  // Cloudinary secure URL
    originalFilename: { type: String, default: "" },  // Original filename
    mimeType: { type: String, default: "" },  // MIME type
    createdAt: { type: Date, default: Date.now }
}, { _id: true });

const ReviewAccessMessageSchema = new mongoose.Schema({
    sourceMessageId: { type: String, default: "" },
    senderId: { type: String, default: "" },
    senderName: { type: String, default: "" },
    contentForAdmin: { type: String, required: true },
    contentHash: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
}, { _id: false });

const ReviewAccessGrantSchema = new mongoose.Schema({
    grantedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    titleForAdmin: { type: String, required: true },
    descriptionForAdmin: { type: String, required: true },
    priceForAdmin: { type: String, required: true },
    messages: [ReviewAccessMessageSchema],
    grantedAt: { type: Date, default: Date.now },
}, { _id: true });

const ContractSchema = new mongoose.Schema({
    // Idempotency key for the temporary-contract finalization step. A sparse
    // unique index keeps legacy rows valid while ensuring one final contract
    // can be created for each invitation.
    sourceTempContract: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TempContract"
    },

    userA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    userASign: { type: Boolean, default: true },
    userBSign: { type: Boolean, default: true },

    status: {
        type: String,
        enum: ["pending", "active", "accepted", "rejected", "completed", "disputed"],
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

disputeReasonUserA: { type: String, default: "" },
    disputeReasonUserB: { type: String, default: "" },
    // F-12: new disputes encrypt the reason to the admin review key and no
    // longer persist the plaintext. Legacy rows carry plaintext above.
    disputeReasonEncryptedUserA: { type: String, default: "" },
    disputeReasonEncryptedUserB: { type: String, default: "" },
    disputedAtUserA: { type: Date, default: null },
    disputedAtUserB: { type: Date, default: null },

    statusBeforeDispute: {
        type: String,
        enum: ["pending", "active", "accepted"],
        default: null,
    },
    disputeState: {
        type: String,
        enum: ["none", "open", "resolved"],
        default: "none",
    },
    resolutionOutcome: {
        type: String,
        enum: ["resume", "complete", "cancel"],
        default: null,
    },
    resolutionNote: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },
    reviewAccessGrants: [ReviewAccessGrantSchema],

    hash: { type: String, default: "" },

    messages: [EmbeddedMessageSchema],
    media:    [EmbeddedMediaSchema]

}, { timestamps: true });

ContractSchema.index(
    { sourceTempContract: 1 },
    {
        unique: true,
        partialFilterExpression: {
            sourceTempContract: { $type: "objectId" }
        }
    }
);
ContractSchema.index({ userA: 1, updatedAt: -1 });
ContractSchema.index({ userB: 1, updatedAt: -1 });
// F-46: the admin dispute/review queries (listDisputes, getDispute) and the
// "recent contracts" feed (getContracts) were previously doing collection
// scans filtered in memory.
ContractSchema.index({ status: 1, updatedAt: -1 });
ContractSchema.index({ disputeState: 1, updatedAt: -1 });
ContractSchema.index({ createdAt: 1 });

export default mongoose.model("Contract", ContractSchema);
