import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    firebaseID: { type: String, required: true, unique: true },

    firstName: { type: String, default: "" },
    lastName:  { type: String, default: "" },

    email:     { type: String, default: "" },  // pulled from Firebase only

    publicKey:          { type: String, default: "" },
    encryptedPrivateKey: { type: String, default: "" },

    isComplete: { type: Boolean, default: false },  // true after finalize

    fcmTokens: [{ type: String }]  // multi-device support

}, { timestamps: true });

export default mongoose.model("User", UserSchema);
