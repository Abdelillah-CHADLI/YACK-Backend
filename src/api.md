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
| `POST` | `/finalize` | Complete account setup. | `firstName`, `lastName`, `publicKey`, `encryptedPrivateKey` (all required strings) | Requires verified Firebase email. Sets `isComplete: true`. |
| `GET` | `/profile` | Get user profile with keys. | None | Returns `firstName`, `lastName`, `email`, `publicKey`, `encryptedPrivateKey`, `isComplete`. |
| `PUT` | `/private-key` | Update encrypted private key. | `encryptedPrivateKey` (string, required) | For re-encrypting the same private key with a new password. |
| `PUT` | `/profile` | Update profile info. | `firstName`, `lastName` (optional strings) | At least one field required. |

---
## Contract Routes (`/contracts`)
| Method | Path | Description | Body Fields | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/create` | Start a temporary contract. | `hash` (optional), `titleUserA`, `descriptionUserA`, `priceUserA`, `detailsHash` (all required) | Encrypted fields for creator. Returns `tempID` for sharing. |
| `POST` | `/join` | Join a temp contract as user B. | `tempID` (required), `hash` (if temp has hash), `titleUserB`, `descriptionUserB`, `priceUserB` (all required) | Returns userA info including `publicKey`. |
| `POST` | `/sign` | Sign a temp contract. | `tempID` (string, required) | When both users sign, a `Contract` record is created with all encrypted fields. |
| `POST` | `/accept` | Mark a contract as accepted by the caller. | `contractId` (string, required) | Requires membership; completes contract when both accept. |
| `POST` | `/dispute` | Flag a contract as disputed. | `contractId` (string, required), `reason` (string, optional) | Fails if contract already completed or disputed by caller. |
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
Successful signing by both parties returns the final `contractID`.

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
| `POST` | `/send` | Store an uploaded media payload and attach metadata to the contract. | `{ "contractId": "...", "file": { "filename": "proof.png", "buffer": "<base64>" } }` |
| `GET` | `/all` | Return all media entries for a contract. | Query: `contractId` |

`POST /media/send` uses `MediaHandler.send` to persist the binary payload (currently to `uploads/`). The response includes the stored record from `contract.media`; consumers can later fetch the binary using the saved path.

---
## Notifications
Certain actions (`join`, `sign`, `accept`, `dispute`, `sendMessage`, `sendMedia`) trigger push notifications via `sendNotification`, using the recipient's registered FCM tokens. See `notification.md` for full details.

---
## Error Handling
Responses on failure follow `{ "error": "Message" }` with an HTTP status code describing the issue (400 validation, 401 auth, 403 permission, 404 not found, 500 unexpected errors).
