# PROGRESS.md

## Current step
Step 3.

## How to run a step
In Claude Code, from this folder, say: "Read AGENTS.md and PROGRESS.md, then do the current step." Use plan mode, and read the plan before approving it. When the step works, commit it, then run `/clear` before starting the next one.

## Part 1: the app on localhost

- [x] **1. Scaffold.** Set up the project per the AGENTS.md stack. `npm run dev` starts the server and web app. The page shows the notebook paper background and the header (today's date in Caveat, plus the time). It uses the prototype's CSS variables and fonts, and switches between day and night automatically (night from 8pm to 8am). `npm run check` runs typecheck, lint, and one trivial test. Add `npm run dev` to `.claude/launch.json` so the Claude browser pane can open the app.
- [x] **2. Data model and seed.** Tables for everything in spec §9, §10, and §13:
  - Tasks with steps, notes, categories, windows, deadlines, estimates, and check-in conditions.
  - Routines with repeats.
  - Routine times on the schedule, with per-day exceptions.
  - Weekly classes, with skipped days.
  - One-off blocks: events, open time, and placed tasks with pinned or penciled status and a reason.
  - Sometime entries.
  - Settings.

  Use Drizzle migrations. `npm run seed` loads spec §16 and does nothing if data already exists.
- [ ] **3. Core: time and recurrence.** Pure functions in `src/core`, with tests:
  - The 4am day boundary.
  - Time zones, including the Nov 1, 2026 daylight saving change and travel (a 2pm Chicago class shows at 3pm in New York, while a 9am routine stays at 9am).
  - Occurrences of weekly classes, and of daily, weekly, and every-other-week routines, with per-day exceptions.
  - Rollover.
  - Urgency windows and overdue status (spec §10).
- [ ] **4. API.** Endpoints to read a day (blocks, Sometime lane, Daily checklist, task groups), a week, and a month, and to create, update, and delete every kind of item. All input is validated with Zod. Tests run against an in-memory database.
- [ ] **5. Day view, wide.** Read-only plus check-off. Covers:
  - The header (spec §6).
  - The schedule (spec §7): folded hours, the now line, deadline lines, and every block type.
  - The task panel (spec §9): groups, cards, the Daily checklist, and filter chips.
  - The Sometime lane, and the Plan button as a placeholder.
- [ ] **6. Editing.**
  - Delete with Undo.
  - Task details (steps and notes) and the category dot picker.
  - Decisions and check-ins.
  - Skipping a class or routine for one day.
  - The weekly class editor.
- [ ] **7. Drag and drop.** Port the prototype's pointer-based drag, which handles mouse and touch (press and hold). Include:
  - Every rule in spec §10's table.
  - Resizing.
  - Pinned versus penciled.
  - Auto-scroll near the edges.
  - Folded hours opening when dragged over.
- [ ] **8. Week, month, and the left rail** (spec §5 and §8).
- [ ] **9. Phone layout** (spec §5):
  - The drawer, the spread-out tab row, and Back to today.
  - Phone week: one day per row, with the time grid kept as an option until decided.
  - Phone month.
- [ ] **10. AI parser** (spec §11). A server endpoint using the Anthropic SDK, the prompt rules from §11, chunking, the fallback, and the result message. Add a test that runs the local fallback on `tests/fixtures/todo-oct-1.txt`. Then the user does one manual check with the real API, using their key in `.env`.
- [ ] **11. Planner** (spec §12):
  - The Plan button, scoring, free time, the deadline limit, and reasons.
  - The automatic scheduling setting, off by default.
  - The capacity warning.
  - The "how long did it take?" prompt.
- [ ] **12. Settings sheet** (spec §13), including automatic night mode and the time zone setting.
- [ ] **13. Use it daily for a week.** Collect annoyances in the Backlog below, then fix the worst ones.

## Part 2: online

- [ ] **14. Go online.** Pick a host, move the database, add a sign-in for one user, and make the app installable on the phone home screen.
- [ ] **15. Notifications** (spec §13 list) through web push.
- [ ] **16. Google Calendar** (spec §14): sign-in and reading events first, then optional write-back.
- [ ] **17. Canvas calendar feed** (spec §14).

## Backlog
Ideas and annoyances from using the app. Add them here. Don't fix them in the middle of another step.
-

## Notes
Agents add short notes here when a step is done.
- Step 1: Vite (5173, root `src/web`) proxies `/api` to Hono (8787, override with `API_PORT`, not `PORT`, since the preview pane sets `PORT`). `src/core/look.ts` decides day/night (tested); ESLint blocks server/web/db imports in `src/core`. The header date uses a simple 4-hour offset for the 4am boundary; step 3 replaces it with the core function. Phone layout is a `max-width:700px` media query. SQLite/Drizzle are added in step 2 and the Anthropic SDK in step 10.
- Step 2: Drizzle schema in `src/server/db/schema.ts`, migrations in `drizzle/` (regenerate with `npm run db:generate`), applied by `openDb()` in `client.ts` (tests use `openDb(':memory:')`). Deadlines are `due_at` (UTC, time given) or `due_date` (day only), never both. Classes store Chicago wall-clock `HH:mm` plus a `time_zone` column. Routine times are `routine_slots` with per-day `routine_slot_exceptions` (skip or move). Overdue isn't stored; it's derived. Settings are one row (id 1). Weekdays are 0–6 with Sunday as 0. The seed fills an empty database only. Seed choices not in the spec: meditate is 10 min, gratitude 15, laundry and dorm 60. Shopping is This week, and Epiphany is Ongoing per §16 (the prototype had Soon).
