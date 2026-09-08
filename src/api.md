# YACK Backend API Reference

All endpoints are served from the Express app in `src/index.js`. Unless stated otherwise, requests and responses use JSON.

## Authentication
- Every request (except `/`) must include a Firebase ID token in the `Authorization` header: `Authorization: Bearer <token>`.
- The `auth` middleware will create a placeholder `User` document on first login. Users must call `/user/finalize` to complete account setup with verified email, name, and encryption keys.

## Common Parameters
- `contractId`: MongoDB ObjectId referencing a `Contract`. Required by any route protected with `checkContractPermission`. Send it in the JSON body for `POST` routes or as a query parameter for `GET` routes.

---
## User Routes (`/user`)
| Method | Path | Description | Body Fields | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/finalize` | Complete account setup. | `firstName`, `lastName`, `publicKey`, `encryptedPrivateKey`, `salt`, `iv` (all required strings) | Requires verified Firebase email. Sets `isComplete: true`; same-key retries are idempotent. |
| `GET` | `/profile` | Get user profile with keys. | None | Returns names, email, public/encrypted-private key material, `salt`, `iv`, `language`, and `isComplete`. |
| `PUT` | `/private-key` | Update encrypted private key. | `encryptedPrivateKey`, `salt`, `iv` (required strings) | For re-encrypting the same private key with a new password. |
| `PUT` | `/profile` | Update profile info. | `firstName`, `lastName`, `language` (`en`, `fr`, or `ar`) | At least one field required. |
| `POST` | `/fcm-token/register` | Bind a notification device to the signed-in account. | `fcmToken` | A token is moved away from any previous account before registration. |
| `POST` | `/fcm-token/unregister` | Remove a notification device before logout. | `fcmToken` | Idempotent when the token is not present. |

---
## Contract Routes (`/contracts`)
| Method | Path | Description | Body Fields | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/create` | Start a temporary contract. | `hash` (optional), `titleUserA`, `descriptionUserA`, `priceUserA`, `detailsHash` (all required) | Encrypted fields for creator. Returns `tempID` for sharing. |
| `POST` | `/join` | Join a temp contract as user B. | `tempID`, `detailsHash`, `titleUserB`, `descriptionUserB`, `priceUserB` (required); `hash` if the temp has one | The SHA-256 `detailsHash` must match the creator's terms. The reservation is atomic and same-user retries are idempotent. Returns userA info including `publicKey`. |
| `POST` | `/sign` | Sign a temp contract. | `tempID` (string, required) | Signature retries are idempotent. When both users sign, exactly one `Contract` is materialized and `contractID` is returned. |
| `GET` | `/temp/status` | Poll invitation/signature state. | Query: `tempID` | Returns `waiting_for_join`, `waiting_for_signatures`, `finalizing`, `completed`, `cancelled`, or `expired`. Before reservation, any authenticated active account may read safe metadata; afterward it is participant-only. No ciphertext is returned. |
| `DELETE` | `/temp/:tempID` | Cancel a temporary invitation. | URL parameter: `tempID` | Creator-only and idempotent. Cancellation is retained as a short-lived tombstone until the invitation TTL removes it. |
| `POST` | `/accept` | Mark a contract as accepted by the caller. | `contractId` (string, required) | Requires membership; completes contract when both accept. |
| `POST` | `/dispute` | Flag a contract as disputed. | `contractId` (string, required); `encryptedReason` (string, optional, RSA-OAEP envelope for the shared admin review key) or legacy `reason` (string, optional) | Fails if contract already completed or disputed by caller. With `encryptedReason`, the plaintext reason is not stored and is excluded from `/list` responses. |
| `GET` | `/verify` | Compare stored contract hash with a provided hash. | Query/body `contractId`, `hash` (string, required) | Response indicates `matches`. |
| `GET` | `/list` | Fetch all contracts involving the caller. | None | Returns only caller's encrypted fields (`title`, `description`, `price`). |

### Encryption Notes
- Contract details (title, description, price) are encrypted separately for each party using their public keys.
- `detailsHash` is a SHA hash of the plaintext title+description+price for verification.
- The response from `/list` maps encrypted fields to generic `title`, `description`, `price` based on whether caller is userA or userB.

### Example: Create → Join → Sign
```http
POST /contracts/create
Authorization: Bearer <token>
Content-Type: application/json

{
  "hash": "abc123",
  "titleUserA": "<encrypted>",
  "descriptionUserA": "<encrypted>",
  "priceUserA": "<encrypted>",
  "detailsHash": "<sha256>"
}
```
Response:
```json
{ "success": true, "tempID": "665dd..." }
```

```http
POST /contracts/join
Authorization: Bearer <token>
Content-Type: application/json

{
  "tempID": "665dd...",
  "hash": "abc123",
  "detailsHash": "<same sha256 digest from the reviewed QR terms>",
  "titleUserB": "<encrypted>",
  "descriptionUserB": "<encrypted>",
  "priceUserB": "<encrypted>"
}
```
Response includes `userAPublicKey` for encrypting messages.

```http
POST /contracts/sign
Authorization: Bearer <token>
Content-Type: application/json

{ "tempID": "665dd..." }
```
Successful signing by both parties returns the final `contractID`. While waiting,
clients should also poll `GET /contracts/temp/status?tempID=665dd...`; push
notifications are an optimization and are not required for completion.

---
## Message Routes (`/messages`)
Protected by `auth` + `checkContractPermission`.

| Method | Path | Description | Payload |
| --- | --- | --- | --- |
| `POST` | `/send` | Append an encrypted message to a contract. | `{ "contractId": "...", "contentForSender": "<encrypted>", "contentForRecipient": "<encrypted>", "contentHash": "<sha256>" }` |
| `GET` | `/all` | Retrieve contract messages (newest 50 by default). | Query: `contractId`, optional `limit` |

### Encryption Notes
- `contentForSender`: Message encrypted with sender's public key (for sender's own copy).
- `contentForRecipient`: Message encrypted with recipient's public key.
- `contentHash`: SHA hash of plaintext message for verification.
- GET `/all` returns only the caller's decryptable version in the `content` field.

Response shape:
```json
{
  "success": true,
  "messages": [
    {
      "_id": "...",
      "who": { "_id": "...", "firstName": "Ada", "lastName": "Lovelace" },
      "content": "<encrypted for caller>",
      "contentHash": "<sha256>",
      "createdAt": "2025-12-05T12:34:56.789Z"
    }
  ]
}
```

---
## Media Routes (`/media`)
Also guarded by `auth` + `checkContractPermission`.

| Method | Path | Description | Payload |
| --- | --- | --- | --- |
| `POST` | `/send` | Store an uploaded media payload and attach metadata to the contract. | `{ "contractId": "...", "file": { "filename": "proof.png", "buffer": "<base64>", "mimeType": "image/png" } }` plus, when the client-side envelope is used, `"encryption":"AES-256-GCM"`, `"encryptionVersion":1`, `"iv"`, `"contentHash"`, `"keyOwner"`, `"keyParticipant"`, `"keyAdmin"` |
| `GET` | `/all` | Return all media entries for a contract. | Query: `contractId` |
| `GET` | `/get` | Return one media entry and its usable URL. | Query: `contractId`, `mediaId` |

`POST /media/send` accepts supported image/video/document formats up to 6 MB. In the default legacy flow the server uploads the plaintext payload to Cloudinary and atomically appends the resulting URL and metadata to `contract.media` (`encryptionVersion: 0`). When the client sends an encrypted envelope (`encryptionVersion: 1`), the server validates the AES-256-GCM envelope fields (96-bit `iv`, SHA-256 `contentHash`, and RSA-OAEP-SHA256-wrapped per-reader `keyOwner`/`keyParticipant`/`keyAdmin`), stores the opaque ciphertext on Cloudinary with `resource_type: "raw"`, and records the full envelope on the media entry. The server only ever sees ciphertext for envelope uploads — every reader decrypts client-side.

---
## Support Routes (`/support`)
Guarded by `auth` + `checkContractPermission` (and `requireActiveAccount` except `/review-key`). Only parties involved in an open dispute can access their support case.

| Method | Path | Description | Payload |
| --- | --- | --- | --- |
| `GET` | `/review-key` | Admin review public key for encrypting case material. | Auth only. |
| `GET` | `/thread` | Load the caller's support conversation (messages encrypted for the caller). | Query: `contractId` |
| `POST` | `/review-access` | Share the encrypted contract details + chat for admin review. | `{ "contractId": "...", "titleForAdmin": "<encrypted>", "descriptionForAdmin": "<encrypted>", "priceForAdmin": "<encrypted>", "messages": [...] }` |
| `POST` | `/messages` | Append an encrypted support message. | `{ "contractId": "...", "contentForUser": "<encrypted>", "contentForAdmin": "<encrypted>", "contentHash": "<sha256>" }` |
| `POST` | `/attachments` | Upload a file to the caller's support case. | `{ "contractId": "...", "file": { "filename": "invoice.pdf", "buffer": "<base64>", "mimeType": "application/pdf" } }` plus the same envelope fields as `/media/send` (`keyParticipant` optional) |
| `GET` | `/attachments` | List the caller's support case attachments. | Query: `contractId` |
| `DELETE` | `/attachments/:mediaId` | Remove one of the caller's own attachments. | URL parameter: `mediaId` |

Support attachments accept the same image/video/document formats and size limits as `/media/send`. Legacy uploads are stored as plaintext Cloudinary URLs (`encryptionVersion: 0`); envelope uploads (`encryptionVersion: 1`) are stored as opaquely encrypted `raw` Cloudinary objects with the admin-wrapped key so dispute reviewers can decrypt them in-browser. Both forms are disclosed to administrators per-thread in `GET /admin/disputes/:contractId`.

---
## Notifications
Certain actions (`join`, `sign`, `accept`, `dispute`, `sendMessage`, `sendMedia`) trigger push notifications via `sendNotification`, using the recipient's registered FCM tokens. See `notification.md` for full details.

---
## Error Handling
Responses on failure follow `{ "error": "Message" }` with an HTTP status code describing the issue (400 validation, 401 auth, 403 permission, 404 not found, 500 unexpected errors).
