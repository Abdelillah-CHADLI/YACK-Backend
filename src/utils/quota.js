// src/utils/quota.js
//
// Per-account and per-resource caps enforced atomically at write time
// (F-01, F-36). Caps live in one place so the numbers never drift between
// controllers and the audit records.

export const MAX_MESSAGES_PER_CONTRACT = 500;
export const MAX_MEDIA_PER_CONTRACT = 100;
export const MAX_SUPPORT_MESSAGES_PER_THREAD = 250;
export const MAX_SUPPORT_ATTACHMENTS_PER_THREAD = 25;
export const MAX_SUPPORT_ATTACHMENT_BYTES = 6 * 1024 * 1024;
export const MAX_OPEN_TEMP_CONTRACTS_PER_USER = 50;
export const MAX_FINAL_CONTRACTS_PER_USER = 200;

/**
 * Build a Mongo query predicate that only matches while the target array has
 * fewer than `cap` entries. Used inside the same atomic update that pushes so
 * two concurrent writes cannot race past the cap (F-01/F-44/F-45).
 */
export function arrayBelowCap(fieldPath, cap) {
    return {
        $expr: {
            $lt: [{ $size: { $ifNull: [`$${fieldPath}`, []] } }, cap],
        },
    };
}