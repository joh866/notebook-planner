# AGENTS.md

Instructions for AI coding agents working in this repo. Keep this file short.

## Read first
- `PRODUCT_SPEC.md`: what we're building. Source of truth.
- `PROGRESS.md`: the current step, what's done, and the backlog.
- `design/prototype-6.html`: the visual and interaction reference. Open it in a browser. Match its look and behavior unless the spec says otherwise. Reuse its CSS variables, fonts, and spacing instead of inventing new ones. Its JavaScript is a working reference for behavior (rollover, planner scoring, drag rules). Port the logic into typed, tested modules rather than copying it wholesale.

## Commands (exist after step 1)
- `npm run dev`: start the server and the web app
- `npm run check`: typecheck, lint, and tests. Must pass before a step is done.
- `npm test`: tests only
- `npm run seed`: load the starting data from spec §16 (exists after step 2)

## Structure
```
src/core/    Planner, time, and recurrence logic. Pure: no database, no network, no Date.now(). `now` and the time zone are passed in.
src/server/  Hono API and SQLite. Loads data, calls core, returns results. The only code that reads secrets.
src/web/     React UI. Displays results and sends user actions. Never calculates the plan itself.
src/shared/  Zod schemas and types used by both server and web.
design/      The prototype. Reference only, never imported.
tests/fixtures/  Sample inputs, like the original todo list.
data/        The real database (planner.db). Gitignored.
```
`src/core` must never import from `src/server` or `src/web`.

## Stack
TypeScript · React + Vite · plain CSS with variables (no Tailwind) · Hono on Node · SQLite (better-sqlite3 + Drizzle) · Zod · Luxon · Vitest · Anthropic TypeScript SDK (server only)

## Conventions
- Durations are whole minutes.
- One-time moments (a deadline with a time, a one-off event) are stored as UTC ISO strings.
- Repeating things that happen in Chicago (classes) are stored as clock time plus time zone.
- Times that follow the user wherever they are (routines, wake time, bedtime) are stored as local "HH:mm".
- A deadline with no time is stored as a date only.
- Derived states (overdue, urgency windows) are calculated, never stored.
- The home time zone is America/Chicago. Use Luxon for all time zone math so daylight saving (it ends Nov 1, 2026) stays correct.
- A day starts at 4:00 AM local (spec §3).
- Anything that removes or moves something the user made supports Undo.

## Secrets
- Secrets live in `.env`, which is gitignored. `.env.example` lists the names with no values.
- Never print, log, or commit a secret, and never send one to the browser.
- Never ask the user to paste a key into the chat. Ask them to put it in `.env` themselves.
- The Anthropic key is read on the server only, as `ANTHROPIC_API_KEY`. The model name comes from `ANTHROPIC_MODEL`.

## Rules
1. Work only on the current step in PROGRESS.md.
2. Before editing, give a short plan: files you'll touch, any new dependency, any schema change.
3. No unrelated refactors.
4. Never change an existing test's expected result to make it pass. Stop and explain instead. The one exception: when the spec deliberately replaces exactly what a test checks, rewrite that test to the new behavior, keep its intent where it still applies, and list every changed test in that step's PROGRESS notes. Any other failing test still means stop and ask.
5. Never delete or overwrite `data/planner.db`. Tests use an in-memory database.
6. If a request conflicts with PRODUCT_SPEC.md, stop and ask. When the user decides something new, update the spec in the same step and add a line to its change log.
7. The UI must work at phone width (390px) and at desktop widths.
8. When a step is done: `npm run check` passes, the step is ticked in PROGRESS.md with short notes, and you suggest a one-line commit message.
