# Notification Reference

Push notifications rely on Firebase Cloud Messaging via `sendNotification`. Each message targets the *other* contract participant whenever a user performs a relevant action. All notifications share this envelope:

```json
{
  "title": "Human readable subject line",
  "body": "Short description",
  "data": {
    "type": "<eventIdentifier>",
    // Additional type-specific keys
  }
}
```

To receive notifications a `User` document must contain at least one valid `fcmTokens` entry.

---
## Events

### contractJoin
- **Trigger**: A second user joins a temporary contract (`POST /contracts/join`).
- **Audience**: Original contract creator (user A).
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractJoin"` | Discriminator for client routing. |
| `userId` | `string` | Mongo `_id` of the joining user. |
| `username` | `string` | First name of the joining user, suitable for UI copy. |

### contractSign
- **Trigger**: Either user signs the temporary contract (`POST /contracts/sign`).
- **Audience**: The other user who has not just signed.
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractSign"` | Indicates the contract gained a signature. |
| `userId` | `string` | `_id` of the user who signed. |
| `username` | `string` | First name of the signer. |

### contractAccept
- **Trigger**: A user accepts an active contract (`POST /contracts/accept`).
- **Audience**: Counterparty on the same contract.
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractAccept"` | Accept event identifier. |
| `userId` | `string` | `_id` of the accepting user. |
| `username` | `string` | First name of the acceptor. |

### contractDispute
- **Trigger**: A user disputes a contract (`POST /contracts/dispute`).
- **Audience**: Counterparty.
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractDispute"` | Dispute event identifier. |
| `reason` | `string` | Optional free-text reason provided when disputing. |
| `userId` | `string` | `_id` of the user filing the dispute. |
| `username` | `string` | First name of the disputing user. |

### contractMessage
- **Trigger**: User posts a new message through `/messages/send`.
- **Audience**: Other contract participant.
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractMessage"` | Chat message event identifier. |
| `contractId` | `string` | Contract `_id` for which the message was recorded. |

The notification body currently includes the sender name and the first 50 characters of the message.

### contractMedia
- **Trigger**: User uploads media via `/media/send`.
- **Audience**: Other contract participant.
- **Data payload**:

| Key | Type | Description |
| --- | --- | --- |
| `type` | `"contractMedia"` | Media upload event identifier. |
| `contractId` | `string` | Contract `_id` tied to the media entry. |
| `mediaPath` | `string` | Stored path returned by `MediaHandler.send` for later retrieval. |

The notification body references the uploader's first name plus the file name (when available) to provide context.

