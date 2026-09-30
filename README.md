# Location Wrapped — CSCE 482 Capstone

A private, local-first location history app for iOS and Android. Record your own
location (with permission), import Google Timeline JSON, explore a chronological
Timeline and map, label places, and generate a personal Wrapped summary. The app
keeps imported and recorded points on your device. A separate demo experience
uses sample data and never presents it as your own history.

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
- `backend/`: original Orbit FastAPI backend, preserved as independent source.
- `docs/`: original capstone reports and evaluation documentation.

The mobile app **does not** connect to the Orbit backend. Its account, sync,
Discover and prediction features are not enabled: connecting them requires a
deliberate identity and privacy model. See [backend/README.md](backend/README.md)
to operate and test that separate service.

## Checks

```bash
npm run typecheck
npm test
npx expo-doctor
```

Location history is sensitive. Avoid committing Timeline exports, real location
points, SQLite databases or local credentials. Removing a file import leaves
device-recorded GPS points intact; clearing history removes both. Shared cards
mask real place names.
