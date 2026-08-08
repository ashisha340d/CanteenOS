# MenuBoard — Mobile App

Phase 4: project setup, SQLite, auth, navigation and all collaboration screens, built against
real backend data through an on-demand REST→SQLite population step (the real sync engine is
Phase 5, `/tasks/PHASE_5.md`). See `AGENTS.md` for stack/conventions and the sync phase
boundary, and `../docs/MENUBOARD_SPEC.md` / `../docs/ARCHITECTURE.md` for the overall project
brief.

## Setup

```bash
# once, from the repo root — @menuboard/shared is consumed as a file: dependency
npm run build --workspace @menuboard/shared

cd app
npm install
```

Start the backend separately (repo root): `npm run dev:backend` (see the root
[README.md](../README.md) for full setup including `npm run migrate` / `npm run seed`).

## Run

```bash
npm run start        # Expo dev server; press 'a' for an Android emulator/device
```

`app.json`'s `expo.extra.apiBaseUrl` defaults to `http://10.0.2.2:4000/api/v1`, the Android
emulator's alias for the host machine's `localhost`. Point it at your LAN IP for a physical
device.

Sign in with any seeded account (see the root README), e.g. `user1` / `MenuBoard@2026`. Every
seeded account is flagged `mustChangePassword`, so the app routes to the forced
password-change screen first.

## Verify

```bash
npm run typecheck
npm run lint
```
