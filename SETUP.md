# YACK — Setup & Runbook

This project uses three external services (all owned by YOU after setup):

| Service | Purpose |
| --- | --- |
| **Firebase** | Auth (ID tokens), Cloud Messaging (push), Crashlytics |
| **MongoDB Atlas** | Primary database (mongoose) |
| **Cloudinary** | Media/file storage |

Previously these belonged to the original author. This guide rewires everything to your
own accounts. Nothing here requires the original author's credentials.

---

## 1. Create a Firebase project (Auth + FCM)

1. Go to <https://console.firebase.google.com> and create a **new project**.
2. In **Project settings → Service accounts** → **Generate new private key**.
   This downloads a `serviceAccountKey.json` — you'll use it for the backend.
3. In **Project settings → Cloud Messaging**, confirm the Android app is registered and FCM is enabled.

### Flutter app side
Run the FlutterFire CLI inside the **YACK** (Flutter) directory to regenerate config for your project:

```bash
# make sure flutterfire_cli is installed
dart pub global activate flutterfire_cli
flutterfire configure
```

Select your new Firebase project. This rewrites:
- `lib/firebase_options.dart`
- `android/app/google-services.json`

> Note: `flutterfire configure` registers an Android app with the current `applicationId`
> (`com.example.yack` by default in `android/app/build.gradle.kts`). If you change the
> applicationId, update it in both files.

---

## 2. Create a MongoDB Atlas cluster

1. Create a free **M0 cluster** at <https://www.mongodb.com/atlas>.
2. Go to **Database → Connect → Drivers** and copy the connection string, e.g.:
   ```
   mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/
   ```
3. Whitelist your IP (or `0.0.0.0/0` for dev).

---

## 3. Create a Cloudinary account

1. Sign up at <https://cloudinary.com> (free).
2. From the **Dashboard**: note `cloud_name`, `API key`, `API secret` (or use the **API Keys** page).

---

## 4. Configure the backend

In the **YACK-Backend** directory:

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```ini
PORT=3000                                   # use 3000 for local dev, 80 for Leapcell
MONGO_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/
FIREBASE_PROJECT_ID=<your-project-id>
FIREBASE_CLIENT_EMAIL=<firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com>
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-api-key>
CLOUDINARY_API_SECRET=<your-api-secret>
```

> `FIREBASE_PRIVATE_KEY` must keep the literal `\n` (escaped newlines) — copy the value
> directly from the downloaded `serviceAccountKey.json`'s `private_key` field.
>
> Alternative to the three `FIREBASE_*` vars: download your service account JSON, save it as
> `src/config/serviceAccountKey.json` (never commit it), and the backend will pick it up
> automatically.

Run locally:

```bash
npm run dev     # or: npm start
```

The server loads `.env` automatically and fails fast with a clear message if any credential
is missing.

---

## 5. Point the Flutter app at your backend

The app reads the backend URL from a build-time define. Default is the old
`https://yack.leapcell.app` — always pass your own.

**Android emulator / local backend:**
```bash
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000
```
(`10.0.2.2` maps to your PC's localhost from the Android emulator.)

**Web / desktop / real device:** use your machine's LAN IP or the deployed URL.

---

## 6. Deploy the backend (Leapcell)

1. Push the **YACK-Backend** repo to GitHub.
2. Create a Leapcell project pointing at that repo.
3. In the Leapcell **environment** panel, set the **same variables as your `.env`**
   (as real environment variables, no `.env` file needed). Leave `PORT=80`.
4. Deploy. Your backend URL becomes `https://<subdomain>.leapcell.app`.

## 7. Build the app against production

```bash
flutter build apk --dart-define=API_BASE_URL=https://<your-subdomain>.leapcell.app
```

---

## Security notes

- **Never commit** `.env` or `serviceAccountKey.json` — both are gitignored.
- The original Firebase service-account key was previously committed to git history.
  Ask the original author to **rotate/revoke** it in the old project.
- Cloudinary/Firebase/Mongo credentials should only ever live in `.env` / the host env.

---

## Environment variable reference

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | no (default 80) | 3000 for local, 80 on Leapcell |
| `MONGO_URI` | yes | Atlas connection string |
| `FIREBASE_PROJECT_ID` | yes (or service JSON) | From Firebase settings |
| `FIREBASE_CLIENT_EMAIL` | yes (or service JSON) | Firebase service account |
| `FIREBASE_PRIVATE_KEY` | yes (or service JSON) | Keep escaped `\n` |
| `CLOUDINARY_CLOUD_NAME` | yes | Cloudinary dashboard |
| `CLOUDINARY_API_KEY` | yes | Cloudinary API Keys |
| `CLOUDINARY_API_SECRET` | yes | Cloudinary API Keys |
