# MenuBoard — Agent Rules

Read this file first, on every task, before writing any code. It is the general rulebook;
it points to the specific document that has the detail you need.

## Read before you start

- [MENUBOARD_SPEC.md](./MENUBOARD_SPEC.md) — what MenuBoard is, who it's for, hard
  exclusions, product decisions. Treat as the immutable product contract.
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system topology, backend layering rules, offline
  sync contract, auth model. Treat as the immutable technical contract.
- [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md) — UI/UX standards for both clients. Mandatory for
  any UI work.
- [API.md](./API.md) — REST + Socket.IO contract. Treat as immutable; do not invent
  endpoints or fields.
- [DATABASE.md](./DATABASE.md) — MariaDB + SQLite schema and rationale. Treat as immutable.
- `/tasks/PHASE_*.md` — the specific brief for whichever phase you've been assigned. It
  narrows scope further than this file; follow it exactly.
- Per-app conventions: `app/AGENTS.md` for the Android app, and (once it exists) an
  equivalent file for `admin/` — read the one for whichever workspace you're touching.

## Global rules — apply to every phase, every task

1. **Treat as immutable**: database schema, REST API contracts, authentication flow, folder
   structure, SQLite schema, naming conventions, overall architecture. Do not redesign the
   project. If something here seems wrong, say so and ask — don't quietly work around it.
2. **Do not add features outside your assigned phase/task scope.** If a request maps to a
   hard exclusion in MENUBOARD_SPEC.md, say it's out of scope before writing any code.
3. **Do not modify completed phases or other workspaces unless the task explicitly requires
   it.** If your task depends on a change in a phase/workspace you don't own: **stop, report
   the dependency, and do not implement it yourself.**
4. **Write production-quality code only.** No placeholder code, no demo code, no mock
   implementations, no TODOs, no unfinished features. If a screen/endpoint is in scope, it
   must actually work end to end against the real system, not a stub.
5. **Follow existing architecture and coding conventions** — match the strictness, layering,
   and naming already established in the workspace you're editing.
6. **Verify before declaring done.** Run the build/typecheck/lint for whatever you touched.
   If your environment can't execute commands, say so explicitly in your summary and list
   the exact commands the next agent/human must run — don't claim something works when you
   couldn't check it.
7. **Return a summary of completed work at the end** — what was built, how it was verified,
   any gaps or blockers found (explicitly, not silently papered over), and confirmation of
   what you did *not* touch.
8. **Stop immediately after your assigned scope.** Do not continue into the next phase, even
   if it looks like the natural next step.

## Workspace map

| Path | What it is | Member of root npm workspaces? |
| --- | --- | --- |
| `shared/` | `@menuboard/shared` — types, enums, DTOs, permissions, constants | Yes |
| `backend/` | `@menuboard/backend` — Express API + MariaDB | Yes |
| `admin/` | `@menuboard/admin` — Web Admin Portal (React + Vite + TS + MUI) | Yes |
| `CustomerKiosk/` | `@menuboard/customer-kiosk` — guest self-service ordering kiosk, a tablet web app (MENUBOARD_SPEC.md §3d) | Yes |
| `app/` | Android operational app (Expo + React Native + TS) | **No** — Metro and npm workspaces interact badly; consumes `@menuboard/shared` via `file:../shared` |
| `docs/` | Product/technical documentation (this tree) | — |
| `tasks/` | Phase-by-phase build briefs | — |

## Verification commands (repo root, unless noted)

```bash
npm install
npm run build            # shared → backend → admin, in order
npm run migrate          # backend: creates DB if absent, applies migrations
npm run seed             # backend: idempotent reference data
npm run dev              # all three: backend 4000, admin 5173, kiosk 5180
                         # `predev` frees those ports and prints the addresses first

npm run dev:backend      # backend: http://localhost:4000
npm run dev:admin        # admin:   http://localhost:5173
npm run dev:kiosk        # kiosk:   http://localhost:5180
                         # each has its own `pre` hook freeing only its own port

npm run lint --workspace @menuboard/admin
npm run typecheck --workspace @menuboard/customer-kiosk
npm run lint --workspace @menuboard/customer-kiosk

cd app && npm install && npm run typecheck && npm run lint && npm run start
```

The mobile app depends on `shared/dist`, so run `npm run build --workspace @menuboard/shared`
at the root before `npm install` inside `app/`.

## UI/UX Pro Max Skill

For any task that changes UI structure, components, colors, typography, layout, animation,
or interaction patterns, consult `.devin/skills/ui-ux-pro-max/SKILL.md` in addition to
[DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). Run searches via:

```bash
python .devin/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain <domain>
```

## Working conventions

- Do not create summary, planning, changelog, or documentation markdown files unless
  explicitly asked (no `NOTES.md`, `SUMMARY.md`, `PLAN.md`, PR-description writeups as
  files). Report progress in chat/PR text, not new files.
- Do not update README or add code comments explaining what changed, why a task was done, or
  referencing issue/task numbers. Comments explain non-obvious *why* only, never task history.
- Confirm the exact scope from the task description before changing anything. If a task is
  ambiguous, ask a clarifying question instead of guessing or expanding scope.
- Prefer the smallest correct diff. No refactors, renames, or cleanups outside task scope.
- Run existing tests/lint before declaring a task done. If no tests cover the touched code,
  say so explicitly rather than skipping verification silently.
- Treat unrelated issues as separate tasks/PRs; do not combine them into one large session.
- Don't add error handling, fallbacks, or config flags for cases that can't occur — trust
  existing guarantees.
