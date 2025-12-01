import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    firebaseID: { type: String, required: true, unique: true },

    firstName: { type: String, required: true },
    lastName:  { type: String, required: true },

    email:     { type: String, default: "" },  // pulled from Firebase only

    fcmTokens: [{ type: String }]  // multi-device support

}, { timestamps: true });

export default mongoose.model("User", UserSchema);
