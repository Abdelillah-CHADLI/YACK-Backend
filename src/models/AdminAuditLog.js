import mongoose from "mongoose";

// Append-only record of privileged admin actions (F-47). Resolving a dispute
// or reading a dispute thread is a high-trust operation; keeping an immutable
// trail with the acting admin uid and the object touched makes the review
// process auditable.
const adminAuditLogSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true },
        action: {
            type: String,
            required: true,
            enum: [
                "dispute.viewed",
                "dispute.resolved",
                "support.message.sent",
                "review.access.viewed",
            ],
        },
        contractId: { type: mongoose.Schema.Types.ObjectId },
        userId: { type: mongoose.Schema.Types.ObjectId },
        summary: { type: String, maxlength: 500, default: "" },
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        strict: true,
    }
);

adminAuditLogSchema.index({ actorId: 1, createdAt: -1 });
adminAuditLogSchema.index({ contractId: 1, createdAt: -1 });

const AdminAuditLog =
    mongoose.models.AdminAuditLog ||
    mongoose.model("AdminAuditLog", adminAuditLogSchema);

export default AdminAuditLog;