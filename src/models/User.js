import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
    firebaseID: { type: String, required: true, unique: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    email: { type: String, default: "" },
    fcmToken: { type: String, default: "" }
}, { timestamps: true });

export default mongoose.model("User", UserSchema);
