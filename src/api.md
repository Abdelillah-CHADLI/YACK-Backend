# YACK Backend API Reference

All endpoints are served from the Express app in `src/index.js`. Unless stated otherwise, requests and responses use JSON.

## Authentication
- Every request (except `/`) must include a Firebase ID token in the `Authorization` header: `Authorization: Bearer <token>`.
- The `auth` middleware will create a `User` document on first login (requires `firstName`, `lastName`, and optional `fcmToken` in the body) and attach it as `req.userDoc`.

## Common Parameters
- `contractId`: MongoDB ObjectId referencing a `Contract`. Required by any route protected with `checkContractPermission`. Send it in the JSON body for `POST` routes or as a query parameter for `GET` routes.

---
## Contract Routes (`/contracts`)
| Method | Path | Description | Body Fields | Notes |
| --- | --- | --- | --- | --- |
| `POST` | `/create` | Start a temporary contract. | `hash` (string, optional) | Returns `tempID` for sharing. |
| `POST` | `/join` | Join a temp contract as user B. | `tempID` (string, required), `hash` (string, required if temp has hash) | Validates hash before attaching user. |
| `POST` | `/sign` | Sign a temp contract. | `tempID` (string, required) | When both users sign, a `Contract` record is created. |
| `POST` | `/accept` | Mark a contract as accepted by the caller. | `contractId` (string, required) | Requires membership; completes contract when both accept. |
| `POST` | `/dispute` | Flag a contract as disputed. | `contractId` (string, required), `reason` (string, optional) | Fails if contract already completed or disputed by caller. |
| `GET` | `/verify` | Compare stored contract hash with a provided hash. | Query/body `contractId`, `hash` (string, required) | Response indicates `matches`. |
| `GET` | `/list` | Fetch all contracts involving the caller. | None | Sorted by `updatedAt` descending. |

### Example: Create → Join → Sign
```http
POST /contracts/create
Authorization: Bearer <token>
Content-Type: application/json

{ "hash": "abc123" }
```
Response:
```json
{ "success": true, "tempID": "665dd..." }
```

```http
POST /contracts/join
Authorization: Bearer <token>
Content-Type: application/json

{ "tempID": "665dd...", "hash": "abc123" }
```

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
| `POST` | `/send` | Append a chat message to a contract. | `{ "contractId": "...", "content": "Hello" }` |
| `GET` | `/all` | Retrieve contract messages (newest 50 by default). | Query: `contractId`, optional `limit` |

Response shape:
```json
{
  "success": true,
  "messages": [
    {
      "_id": "...",
      "who": { "_id": "...", "firstName": "Ada", "lastName": "Lovelace" },
      "content": "Hello",
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
Certain actions (`join`, `sign`, `accept`, `dispute`, `sendMessage`) trigger push notifications via `sendNotification`, using the recipient’s registered FCM tokens.

---
## Error Handling
Responses on failure follow `{ "error": "Message" }` with an HTTP status code describing the issue (400 validation, 401 auth, 403 permission, 404 not found, 500 unexpected errors).
