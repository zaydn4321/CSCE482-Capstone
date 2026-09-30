# Location Wrapped — CSCE 482 Capstone

A private, local-first location history app for iOS and Android. Record your own
location (with permission), import Google Timeline JSON, explore a chronological
Timeline and map, label places, and generate a personal Wrapped summary. By
default, imported and recorded points stay on your device. A separate demo
experience uses sample data and never presents it as your own history.

Team Adobe: George Dai, Zayd Nadir, Tanish Bandari, Hussam Makhoul, Roger Liu.

## Run the mobile app

Use Node.js 22 or newer:

```bash
npm ci
npm start
```

Scan the QR code in Expo Go for foreground features. Background location requires
a native development build, not Expo Go. To test it, use `npx expo run:ios` or
`npx expo run:android` with a simulator and the appropriate native tooling.
Tracking is optional; you can explore the separate demo without granting
permission. Import a supported Android/iOS semantic Timeline JSON export or
legacy Takeout JSON from Profile. Each imported file can be removed independently.

The app uses Location Wrapped's own iOS bundle ID and Android package name, not
the earlier Orbit identifiers. It installs separately from an existing Orbit
app; on-device Orbit history is **not** migrated into this app.

## Structure

- `app/`, `components/`, `context/`, `hooks/`, `constants/`: Expo Router
  screens and Location Wrapped interface.
- `services/`: local SQLite storage, Timeline import, location processing,
  Wrapped generation and unit tests. Background task registration lives in
  `index.js` and must load before Expo Router.
- `backend/`: original Orbit FastAPI backend, used only for opt-in cloud features.
- `docs/`: original capstone reports and evaluation documentation.

## Optional cloud backup

The app works without an account or network connection. On iOS and Android,
account access and manual cloud backup/restore are available only when a
separate Orbit FastAPI server is deployed and an `EXPO_PUBLIC_ORBIT_API_URL`
environment variable points to its HTTPS base URL. For example, set this
variable in your local Expo environment before `npm start`. Never put JWT
signing secrets or database credentials in an Expo public variable.

Signing in never uploads locations. You must separately opt in and choose to
back up device-recorded and imported points. A restore is also a separate
manual action. This is **not automatic two-way sync**: deleting a device import
or clearing device history does not remove a previous cloud backup. Deleting
the cloud account removes its server-owned data but leaves device history.
Demo data, saved place names and Wrapped cards are never uploaded.

Start the FastAPI service, its worker and a persistent database as described
in [backend/README.md](backend/README.md). Set a strong `ORBIT_JWT_SECRET`
and production `ORBIT_DATABASE_URL` and `ORBIT_CORS_ORIGINS`. Server-side visits, recommendations
and predictions require successful backup, a completed recompute job and
their respective place/model setup. They may be unavailable on a newly
configured backend; personal Wrapped continues to work locally.

The app uses the backend's account, batch ingest, export-for-restore, recompute
job, profile/interest, recommendation/feedback and next-place endpoints.
Nearby-place endpoints are intentionally not used: they would transmit a live
coordinate outside the explicit backup action. Device labels and Wrapped stay
local. This version does not mirror deletions or edits automatically across
devices, and it does not offer a separate downloadable raw cloud JSON export.

## Checks

```bash
npm run typecheck
npm test
npx expo-doctor
```

Location history is sensitive. Avoid committing Timeline exports, real location
points, SQLite databases or local credentials. Removing a file import leaves
device-recorded GPS points intact; clearing device history removes both kinds
of local points, not cloud backups. Shared cards mask real place names.
