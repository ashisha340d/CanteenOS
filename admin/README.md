# @menuboard/admin — Admin Portal (Phase 3)

React + Vite + TypeScript + MUI Admin Portal for MenuBoard, consuming the backend REST API
directly (`docs/API.md`). Talks only to the backend — never to the mobile app.

## Getting started

```bash
# from the repo root, after shared and backend are installed/built
npm install
npm run build:shared        # admin imports @menuboard/shared's compiled dist/
cp admin/.env.example admin/.env   # adjust VITE_API_BASE_URL if the backend isn't on :4000

npm run dev:admin           # http://localhost:5173
```

The backend must already be running (`npm run migrate`, `npm run seed`, `npm run dev:backend`)
and its `CORS_ORIGINS` must include `http://localhost:5173` (it does by default).

Sign in with any seeded account, e.g. `admin` / `MenuBoard@2026` — every seeded account is
flagged `mustChangePassword`, so the first sign-in routes to the forced password-change screen.

## Structure

See `src/api`, `src/hooks`, `src/layouts`, `src/pages`, `src/components`, `src/services`,
`src/theme` — one folder per concern, per `docs/DESIGN_SYSTEM.md` Part A and
`/tasks/PHASE_3.md`.

## Verification

```bash
npm run build --workspace @menuboard/admin   # tsc -b (strict) + vite build
npm run lint --workspace @menuboard/admin
```
