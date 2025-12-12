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

    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 15 * 60 * 1000), // 15 minutes from creation
        index: { expires: 0 } // TTL index
    }

}, { timestamps: true });

export default mongoose.model("TempContract", TempContractSchema);
