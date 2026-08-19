# MenuBoard

An operational collaboration platform for catering operations, canteens, temples, kitchens
and event food service coordination.

Its single responsibility is **operational communication and order collaboration**. It is
not a POS, accounting system, inventory system, CRM or ERP — see
[docs/MENUBOARD_SPEC.md](docs/MENUBOARD_SPEC.md).

## Status

See `/tasks/PHASE_3.md` .. `PHASE_7.md` for the authoritative, per-phase status and
acceptance record. Summary:

| Phase | Scope | State |
| --- | --- | --- |
| 1 | Architecture, folder structure, technology setup, database design | Complete |
| 2 | Backend — authentication, MariaDB, REST APIs, Socket.IO | Complete |
| 3 | Admin Portal — auth, masters, boards, reports, billing generation | Complete |
| 4 | Mobile app — project setup, SQLite, authentication, navigation, screens | Complete |
| 5 | Offline synchronisation — queue, conflict resolution, retry, socket updates | Not started |
| 6 | Operational features — media, mentions, notifications, search | Not started |
| 7 | Production stabilization — tests, performance, security, docs | Not started |

## Layout

```
MenuBoard/
├── shared/         @menuboard/shared — types, enums, permission matrix, constants
├── backend/        Express + MariaDB + Socket.IO      (Phase 2)
├── admin/          React + Vite + TS + MUI            (Phase 3)
├── CustomerKiosk/  React + Vite + TS + Tailwind       (guest self-service kiosk, spec §3d)
├── digitalmenu/    one hand-written HTML page         (the menu board above the counter)
├── app/            Expo + React Native + TS           (Phase 4+, not an npm workspace member)
├── docs/           product spec, architecture, design system, API, database, agent rules
└── tasks/          phase-by-phase build briefs (PHASE_3.md .. PHASE_7.md)
```

## Documentation

- [**Agent rules**](docs/AGENTS.md) — **start here if you are picking this up.** Points to
  every other document and states the rules that apply to every phase.
- [Product spec](docs/MENUBOARD_SPEC.md) — mission, scope, hard exclusions, product decisions
- [Architecture](docs/ARCHITECTURE.md) — topology, layering rules, offline sync contract
- [Design system](docs/DESIGN_SYSTEM.md) — UI/UX standards for both clients
- [API](docs/API.md) — REST + Socket.IO contract reference
- [Database](docs/DATABASE.md) — MariaDB and SQLite design, sync cursor
- [`/tasks`](tasks) — the phase-by-phase build briefs and acceptance records

## Getting started

Requires Node.js 20.11+ and MariaDB 10.6+ (or MySQL 8).

```bash
npm install

# Copy the template and set DB_PASSWORD and JWT_SECRET.
cp backend/.env.example backend/.env

npm run build          # builds shared, then backend
npm run migrate        # creates the database if absent, applies migrations
npm run seed           # idempotent reference data and sign-in accounts
npm run dev:backend    # http://localhost:4000
```

Verify a running server:

```bash
npm run smoke          # 104 checks across the whole REST surface
npm run smoke:socket   # Socket.IO handshake, broadcast and notification delivery
```

### Seeded accounts

`superadmin`, `admin`, `manager`, `user1`, `user2` — all with password `MenuBoard@2026`
(override with `SEED_PASSWORD`). Every seeded account must change its password on first
sign-in.

## API

Base path `/api/v1`. Health check at `/health`.

| Group | Purpose |
| --- | --- |
| `/auth` | login, refresh (rotating), logout, me, password, push-token |
| `/users` | user administration (Admin Portal only) |
| `/boards` | boards and board members |
| `/stations`, `/activity-types`, `/menu-categories`, `/menu-items` | masters — read for all, write Admin-only |
| `/orders` | orders, thread, acknowledgements |
| `/attachments` | upload, bind, signed download |
| `/notifications` | the signed-in user's inbox |
| `/sync` | offline push, pull and cursor status |
| `/menu-board` | what a wall screen reads — public and read-only; screen registry Admin-only |
| `/admin` | dashboard, permissions, reports, billing, audit, settings — Admin Portal only |

## The digital menu board

The bilingual menu screen above the counter is `digitalmenu/index.html` — one hand-written
page, no build step, served by the backend at `/menu-board`. A display needs a URL and
nothing else: no install, no launcher, no sign-in.

Which menu a screen advertises, and how it presents itself, is a row in `menu_board_screens`
edited from the Admin Portal under **Menu → Digital Menu Boards**. The screen's code goes in
the URL:

```
http://<backend-host>:4000/menu-board?screen=MAIN
```

Everything on the board comes from Menu Master — prices from the published menu, photography
from the shared media library, the morning menu from each dish's MORNING shift schedule. The
board reads and never writes, and polls its own revision so an unchanged menu costs one small
request per interval.

## Boundaries enforced in code

- Android sessions have administrative capabilities stripped from the token, so billing,
  reports, master maintenance, user management and audit are unreachable from the mobile
  app regardless of the signed-in user's role.
- Billing is an explicitly triggered, one-way, immutable snapshot, always audited.
- Every mutation allocates a global sync cursor and writes an audit row in the same
  transaction as the change it describes.
