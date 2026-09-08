import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    firebaseID: { type: String, required: true, unique: true },

    firstName: { type: String, default: "" },
    lastName:  { type: String, default: "" },

    email:     { type: String, default: "" },  // pulled from Firebase only

    publicKey:          { type: String, default: "" },
    encryptedPrivateKey: { type: String, default: "" },

    salt: { type: String, default: "" },
    iv: { type: String,  default: "" },

    isComplete: { type: Boolean, default: false },  // true after finalize

    // Admin/operator control flag (F-70): when true every authenticated
    // request is rejected with 403 ACCOUNT_BLOCKED. Set via the database or a
    // privileged script; there is no self-service endpoint for it.
    blocked: { type: Boolean, default: false },

    fcmTokens: [{ type: String }],  // multi-device support
    
    language: { type: String, default: "en", enum: ["en", "fr", "ar"] }  // User's preferred language

}, { timestamps: true });

// A device token belongs to exactly one account at a time (F-03): the partial
// unique index rejects any state where two users hold the same token. The
// partial filter keeps users with no tokens out of the index entirely.
UserSchema.index(
    { fcmTokens: 1 },
    { unique: true, partialFilterExpression: { "fcmTokens.0": { $exists: true } } }
);

// F-46: analytics and support lookups filter on the completion flag.
UserSchema.index({ isComplete: 1 });

export default mongoose.model("User", UserSchema);
