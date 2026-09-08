import mongoose from "mongoose";

const TempContractSchema = new mongoose.Schema({
    userA: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userB: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    userASign: { type: Boolean, default: false },
    userBSign: { type: Boolean, default: false },

    // Encrypted contract details for userA (creator sets these)
    titleUserA:       { type: String, default: "" },
    descriptionUserA: { type: String, default: "" },
    priceUserA:       { type: String, default: "" },

    // Encrypted contract details for userB (set when userB joins)
    titleUserB:       { type: String, default: "" },
    descriptionUserB: { type: String, default: "" },
    priceUserB:       { type: String, default: "" },

    // SHA hash of title + description + price combined
    detailsHash: { type: String, default: "" },

    hash: { type: String, default: "" },

    // A finalized temporary contract is retained until its TTL expires. This
    // lets clients safely retry /sign and poll for completion after a lost
    // response or push notification without creating duplicate contracts.
    finalContract: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Contract",
        default: null
    },
    finalizedAt: { type: Date, default: null },

    // Cancellation is intentionally a soft delete. The short-lived record is
    // still removed by the TTL index, while both participants can observe a
    // deterministic cancelled state in the meantime.
    cancelledAt: { type: Date, default: null },

    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from creation
        index: { expires: 0 } // TTL index
    }

}, { timestamps: true });

TempContractSchema.index({ userA: 1, updatedAt: -1 });
TempContractSchema.index({ userB: 1, updatedAt: -1 });
// F-46: the open-invite quota (F-36) counts live invitations per creator, and
// the status/recovery lookups key off the finalized contract id.
TempContractSchema.index({ userA: 1, cancelledAt: 1, finalContract: 1, expiresAt: 1 });
TempContractSchema.index({ finalContract: 1 }, { sparse: true });

export default mongoose.model("TempContract", TempContractSchema);
