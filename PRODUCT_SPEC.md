# Product spec: personal planner

Version 0.3, October 2, 2026. This replaces the September 25 spec from the first attempt.
This file is the source of truth. The latest prototype (`planner-prototype-6.html`) is the visual reference. Where the two disagree, this file wins.

---

## 1. What it is

A planner for one person, a second-year UChicago student. It looks like a calendar, works like a to-do list, and fills in a schedule for you. You can type or paste messy notes, and an AI turns them into tasks, routines, events, and classes. The app then helps place those into your free time.

It runs on a phone, a Mac, and a PC from one codebase.

### Why the first attempt didn't work

Three things, in the user's words from the brainstorm:

- **It didn't look or feel nice.** It was a dark, narrow, form-based list, which is the opposite of the notebook feel the user wants.
- **It forced more precision than the user had.** Real notes say "near near future," "around 7?", and "maybe." The old app wanted fields filled in.
- **Adding things took effort.** It used forms. The new app uses one text box plus AI.

The engineering practices were good and are worth keeping (section 15).

## 2. Principles

1. **Keep the user's fuzziness.** Vague timing ("this week," "sometime today," "around 7") is a first-class value, not a missing field. Never invent a date or time the user didn't give.
2. **Adding is one text box.** Anything typed or pasted gets sorted by AI. Manual edits are quick and optional.
3. **The planner suggests, the user decides.** Blocks the planner places are penciled in and can move. Blocks the user places are pinned and stay put.
4. **Every action can be undone.** Destructive or surprising changes show a message with Undo.
5. **Comforting to look at.** The notebook style, the calm palette, and handwriting accents are part of the product, not polish to add at the end.
6. **Math is code, language is AI.** Scheduling, urgency, and rollover are plain, testable code. The AI only interprets text.

## 3. Platforms and hosting

- **Form:** a web app that can be installed on a phone's home screen (a progressive web app, or PWA). No App Store.
- **Development:** runs on `localhost` on the Mac while building.
- **Daily use:** hosted online so the phone and PC can reach it, and so data syncs across devices. A Mac-only localhost app can't be opened from a phone and stops when the Mac sleeps.
- **Needs a server for:** the AI API key (must never be in the browser), Google sign-in, fetching the Canvas feed, and sending notifications.
- **Time zone:** a setting. "Automatic" follows the device's time zone, and America/Chicago is the home default. (The first attempt hard-coded America/New_York, which was a bug.)
  - Classes and deadlines are fixed moments in Chicago time. When traveling, they show at the correct local time: a 2pm Chicago class shows at 3pm in New York.
  - Routines, wake time, and bedtime follow local time, so a 9am morning routine stays at 9am wherever you are.
  - When the device's time zone differs from Chicago, the header shows a small note saying so.
- **Day boundary:** 4:00 AM. Anything before 4am counts as the previous night.

### Tech stack (decided October 2)

- **Language:** TypeScript everywhere.
- **Web app:** React with Vite. Styles are plain CSS that uses the prototype's CSS variables, so the notebook look carries over exactly (no Tailwind). Installable phone support is added when going online.
- **Server:** Hono on Node, running locally on the Mac. It's portable to an online host later.
- **Data:** SQLite through Drizzle, as one file on the Mac for now. All database access lives in one module so it can move to hosted SQLite when going online.
- **Shared tools:** Zod for data shapes shared by server and web, Luxon for dates and time zones, and Vitest for tests.
- **AI:** the Anthropic TypeScript SDK on the server, reading the key from a `.env` file. The model name is also set in `.env`.
- **Drag and drop:** ported from the prototype's own pointer code, which already handles mouse and touch.
- **Online host:** chosen at the "go online" step, not now.

## 4. Visual design: Notebook

### Overall

- Dot-grid paper background (1.1px dots on a 20px grid). Dots scroll with the content, never fixed in place.
- Panels have solid pen-like borders with slightly uneven corner radii (5px 7px 6px 4px).
- Square checkboxes with a drawn tick.
- Highlighter-style fills for category colors.
- Handwriting font only for headings, the date, tabs, buttons, and notes in red pen. Everything else uses a highly legible body font.

### Fonts

- Handwriting: Caveat (fallbacks: Segoe Print, Bradley Hand).
- Body: Atkinson Hyperlegible (fallbacks: system UI fonts).

### Colors

| Token | Day | Night |
|---|---|---|
| Paper background | #EEECE4 | #1B2130 |
| Dots | #C9C3B2 | #2D3545 |
| Ink (text) | #253047 | #E4DFD1 |
| Muted text | #6B7180 | #979DAB |
| Lines | #D6D0C0 | #323A4C |
| Panel | #F7F5EF | #20273A |
| Card | #FCFBF8 | #252D41 |
| Accent (ink blue) | #2F4F9E | #93B1F2 |
| Red pen (now line, deadlines, overdue) | #C2413B | #EF7F73 |
| Highlighter (active tab, selection) | rgba(224,177,42,.45) | rgba(232,193,78,.32) |
| Amber (capacity warning) | #A8670F | #E8B464 |

Category colors, Highlighter palette (chosen over Ink and Quiet):

| Category | Day | Night |
|---|---|---|
| Classes | #3D63C9 | #7E9CF0 |
| Errands | #E0B12A | #E8C14E |
| Growth | #3F9A73 | #6CC79E |
| Life | #D46B95 | #EE93B6 |
| Routines | #8A79C6 | #ADA0EC |
| Calendar imports / none | #8A8F99 | #8A8F99 |

Blocks are filled with the category color mixed into the card color (30% day, 26% night). Custom categories get colors from a rotating set: #E07B39, #2BA5A5, #C9443A, #7A8B2E, #B05FC4, #4A90D9.

### Day and night

Automatic by default: night from 8pm to 8am, day from 8am to 8pm. Settings can force Day or Night. There's no toggle button in the header.

## 5. Layout

### Wide (Mac, PC)

- **Columns:** schedule on the left, tasks on the right. Both are bordered panels.
- **Left rail:** on screens 1400px and wider, a third column on the far left shows a mini month calendar and a "Coming up" list for the next 10 days (deadlines, events, skipped classes). Clicking any day opens it in the Day view.
- **Task panel:** sticky, with its own scroll.
- **Week and month views:** span the schedule and task columns. The task panel is hidden there.

### Phone

- **Header:** the date is on the far left and the time is on the far right (only when today is on screen).
- **Tab row:** sits below the date. Day, Week, and Month are spread evenly across the row, with the settings button on the right.
- **Schedule:** fills the screen.
- **Tasks:** live in a pull-up drawer.
  - Tap the handle to open it halfway. Tap anywhere outside it, or press Escape, to close it.
  - Drag the handle to resize it. It snaps to closed (64px), half, or full. Full stops just below the header, so the date and deadline line stay visible.
  - Dragging a task out of the drawer closes it so you can drop onto the schedule. It reopens afterward.
- **Drag on touch:** press and hold (280ms), then drag.

## 6. Header

### Left side

The date: "Friday, October 2" on wide screens, "Fri, Oct 2" on the phone. In Week view it shows a range ("Sep 27 – Oct 3"). In Month view it shows "October 2026".

Next to the date is the current time. It only appears when today is on screen: the day itself, the week containing it, or the month containing it.

### Right side

The order is: Back to today (when shown), Day, Week, Month, then Settings.

- **Back to today:** appears only when today isn't on screen.
  - On wide screens it sits directly to the left of the Day tab, at the same height and in the same style as the tabs.
  - On the phone it takes the time's spot on the right of the date row.
- **Tabs:** Day, Week, and Month are all the same width (as wide as "Month") on wide screens, and spread evenly on the phone.
  - The active tab is fully highlighted.
  - Clicking the left half of the active tab goes back one day, week, or month. The right half goes forward.
  - Hovering shades the half you're over. There are no arrow icons.
- **Settings:** a gear button.

### Below the header

A line under the header separates it from the content. Below that line:

- **Overdue:** red, for example "Overdue: the Muqaddimah reading."
- **Next deadline:** for example "Next deadline: Math PSet 1, tomorrow at 11am."
- **Capacity warning:** amber, shown only when it applies. "Heads up" means the work due is more than 50% of your free time before the deadline; "Tight" means more than 80%. Example: "Tight: about 5h of work is due by Tuesday at 2pm, and you have about 4h of free time before then."

## 7. Day view

### Top row of the schedule panel

- **Sometime today (left):** the "Sometime today" lane. Holds tasks committed to the day without a time. It's a drop target, and its chips have a checkbox and an × to send them back to the list.
- **Plan button (right):**
  - Reads "Plan today," "Plan tomorrow," or "Plan Friday" (the weekday, within a week; otherwise "Plan Oct 14").
  - After 9pm today, it plans tomorrow.
  - It's hidden on past days.

### Hours

- The day opens on your usual hours (Settings: up by 9am, asleep by 12am).
- Early morning (6am to wake-up) and late night (bedtime to 3am) fold into thin strips. Click a strip to open it.
- A strip opens on its own when you drag over it, when something is scheduled there, or when the current time is inside it or within 2 hours of bedtime.
- An opened strip can be hidden again unless something forces it open.
- Hours are 52px tall and drops snap to 15 minutes.

### Markers

- **Now line:** red, with the time in the gutter.
- **Past hours:** lightly shaded.
- **Deadlines:** a dashed red line at the due time, with a handwritten label ("Due 2pm: the Muqaddimah reading and the reading response").

### Block types

| Type | Look | Behavior |
|---|---|---|
| Class | Category fill, title like "ECON 20010 lecture," time and short room ("Saieh 021") | Not draggable. Tap for details. × skips this one. |
| Skipped class | Dashed, struck through, "Skipping this one" | Tap or × to un-skip |
| Routine on the schedule | Routine color, repeat icon | Moving it moves this day only, with an "Every day instead" option. × skips this day. |
| Task placed by you | Pin icon | The planner never moves it. |
| Task placed by the planner | Pencil icon | The planner may rearrange it when you plan again. Dragging it pins it. |
| Fixed event | Category fill | Drag to move (pins it) |
| Tentative event ("around 7") | Dashed outline, "Around 7, depends on friends" | Moving it updates "Around X" |
| Open time | Hatched, behind other blocks | Counts as free time for the planner |
| Missed task | Red outline, "Not done yet" | A task block whose time has passed today while it's still unchecked |

Every block has the following:
- **Checkbox:** except classes and open time.
- **× in the top corner:** shown on hover, always faintly visible on touch screens.
- **Resize handle on the bottom edge:** for tasks, events, and routines.
- **Tap for details:** opens a popover with the time, room, full course name, why the planner put it there, pinned or penciled status, and actions (Done, Skip, Pin or Unpin, Back to the list, Edit).

Overlapping blocks share the width side by side. Task blocks show the next unfinished step ("Next: Chapter 2") and where they rolled over from ("From yesterday").

## 8. Week and month views

### Weeks are fixed calendar weeks

A week starts on Sunday by default (Settings can change it to Monday). Moving to tomorrow and then opening Week shows the same week, not a shifted one.

### Week, wide

A time grid inside a bordered box that scrolls on its own.

- Hour labels on the left.
- A sticky header row with each day's name and date.
- An all-day row with deadlines in red and "Sometime" items as chips.
- Classes, events, tasks, and routines placed by time.
- Today's column is tinted and has the now line. Deadlines show as dashed red lines.
- The box opens scrolled to the current time when today is in the week.
- Clicking anywhere in a day's column, header, or all-day cell opens that day in the Day view.

### Week, phone

Two options are in the prototype for comparison. The default is undecided.
- **One day per row:** full-width day cards listing times and titles. It opens scrolled to today.
- **Time grid:** the same grid as on wide screens, with columns about 112px wide. Swipe sideways to see more days, and the hour labels stay put.

### Month

- **Wide:** each day's cell lists its deadlines, events, and weekly chores.
- **Phone:** a compact grid with the day number and up to four dots (red for deadlines, category colors for events), followed by an "In October" list of everything that month.
- **Clicking:** clicking any day cell opens that day.

## 9. Tasks panel

### Add box

At the top of the panel. One text box that grows as you type and accepts a whole pasted list. Enter submits and Shift+Enter adds a new line. While the AI works it shows "Sorting…" (section 11).

### Filter chips

All, Classes, Errands, Growth, Life, plus any custom categories. These double as the color legend.

### Groups, in order

1. **Daily:** the checklist for the selected day.
   - Shows the daily routines plus any weekly ones that fall on that day, like laundry on Saturday.
   - Each row has a checkbox and shows its time if it's on the schedule.
   - Streaks are shown, for example "4-day streak."
   - Rows can be deleted with the trash icon.
2. **Overdue:** red heading. Cards have a red left edge and a solid red "Was due Tue 2pm" chip.
3. **Today or tomorrow**
4. **This week**
5. **Soon**
6. **Waiting on something:** grouped under check-in questions with Yes and Not yet buttons (section 10).
7. **Needs a decision:** "?" items with Yes and No.
8. **Ongoing:** skill-building with no end date.
9. **Done:** collapsed, with a count.

Within a group, tasks with deadlines come first, earliest first.

### Task cards

Outlined boxes. Each card has:
- A checkbox.
- A category dot. Click it to change the category or type a new one.
- The title and a one-line note.
- A detail line: the estimate ("About 3–5h") or the scheduled time ("Today 8:15pm" or "Sometime today"), plus step progress ("1 of 3 steps").
- A due chip:
  - Plain when more than 6 days away.
  - Blue at 2–6 days.
  - Red tint for today or tomorrow.
  - Solid red when overdue.
- A trash icon in the bottom corner.

Click a card to expand it. The expanded card shows:
- **Steps:** a checklist you can add to and remove from.
- **Notes:** for links, materials, anything else.

## 10. Behaviors

### Drag and drop

| From | To | Result |
|---|---|---|
| Task card | Schedule | Placed at that time, pinned |
| Task card or chip | Sometime lane | Committed to the day, no time |
| Daily checklist row | Schedule | Repeats at that time every day (weekly routines: on their day) |
| Task block | Task panel or drawer | Back on the list |
| Event block | Task panel | Removed |
| Routine block | Task panel | Off the schedule on every day, still in the checklist |
| Any movable block | Schedule | Moved and pinned. A routine moves for this day only, with an "Every day instead" option. |

Drops on today can't land in the past. Dragging near the edge scrolls the schedule. Every drop shows Undo.

### Checking things off

- **Tasks:** go to Done.
- **Routines:** checked for that day only.
- **Steps:** checked individually.
- **How long did it take?** When a task with a range estimate is checked off, the app asks "About as planned," "Longer," or "Shorter." This is one tap and optional. Routines, events, and fixed-length sessions never ask. Later, the answers will adjust estimates for similar tasks.

### Rollover

At 4am, any unfinished task that was scheduled on, or committed to, a past day moves to today's Sometime lane, marked "from Thursday." If automatic scheduling is on, the planner also pencils it in.

### Urgency rises as deadlines approach

- More than 6 days away: the task stays in its own window.
- 2–6 days away: moves up to This week.
- Today or tomorrow: moves to Today or tomorrow.
- Past the deadline: moves to Overdue.

### Check-ins for waiting tasks

A waiting task is attached to a question, like "Is the cold fully gone?". Answering Yes moves every task under that question to Soon (Gym and Check out boxing club together). Not yet hides the question until tomorrow.

### Decisions

"?" items have Yes and No. Yes can turn the item into a task ("New blanket?" becomes "Get a new blanket") or perform an action. For example, "Skip econ discussion tomorrow?" marks Friday's discussion as skipped. No drops the item. Both can be undone.

### Undo

Every drop, delete, plan, import, and decision shows a message with Undo.

## 11. AI parser (the add box)

### Input

Anything from one line to a full messy brain dump, including the user's original todo document. Specifically, it must handle:

- **Header lines that apply to the lines under them:** "Category: Homework," "10/6 (Tuesday)," "SOSC 16100," "(before 2:00pm)." These become the due date, due time, and course of the items below them.
- **Remarks in parentheses that describe the item:** "(no specific due date)," "(contingent)," "(daily thing)," "(weekly thing on saturday)," "(biweekly)," "(near near future)," "(near future, about a week)," "(judgment needed)," "maybe," and "?".
- **A time plan for today:** "Right now: 5:30pm," "Dinner: around 7? contingent," "Sleep by 11:30–12:30pm." These become events for today. Approximate ones are tentative, and obvious am/pm slips get fixed.
- **Several things on one line**, which get split.
- **#tags for category:** "#errands" files the item under Errands, and a new #name creates a new category.

### Output per item

The AI returns JSON. Fields are left out when they don't apply.

- **type:** task, routine, event, or class.
- **title:** short, starting with a verb for tasks.
- **meta:** a one-line note.
- **cat:** a built-in or custom category.
- **win:** near, week, soon, ongoing, waiting, or decide.
- **due:** a date, plus a time only if one was given.
- **short:** a 2–4 word name for deadlines.
- **est:** an honest range in minutes.
- **sitting:** the length of one work session, for big tasks.
- **session:** minutes per session, for skill-building items.
- **steps:** the parts of the task.
- **wait:** a yes/no check-in question.
- **repeat:** daily, or specific weekdays, weekly or every other week.
- **date, start, end:** for events and classes.
- **loc:** the location.
- **tentative:** for approximate times.

### Rules

- Never invent a date, time, or deadline that wasn't given.
- Times between midnight and 4am belong to the night of the given day.
- The AI receives today's date, the next 14 days with their weekdays, the current time, and the user's classes, so "before class" and "Tuesday" resolve correctly.

### Long input

- Long pastes are split into chunks of about 12 lines along paragraph breaks, and the chunks are sent in parallel.
- A chunk that fails falls back to a simple local guess.
- The result message says whether the AI sorted it or not, and why it failed if it did.

### After adding

- Items are added right away with no preview step.
- New cards flash briefly and scroll into view. On the phone, the drawer opens.
- The message says exactly what happened, for example: "Added 'Get razor' to This week, penciled in Friday at 4pm."

### Manual category change

Click the colored dot on any card to pick a category or type a new one. Categories can also be renamed or recolored in Settings.

### Model and key

The real build calls Claude through the user's own API key on the server, never from the browser. The prototype calls the API directly, which only works when it's opened inside Claude.

### Categories versus repeats

"Weekly" is a repeat, not a category. The parser sets repeats on routines (laundry every Saturday, cleaning every other Saturday) separately from the category.

## 12. Planner

### Plan button

Plans the target day (section 7). It:
- Removes the penciled blocks from the rest of that day.
- Scores every unfinished task that isn't scheduled.
- Places tasks earliest-first into free time, at most 6 per run.

### Free time

Free time is from your wake time (or now, plus 10 minutes, if planning today) until bedtime. It excludes classes, events, routines on the schedule, and pinned tasks. There's a 10-minute buffer around each busy block. Open time counts as free. Start times round up to 15 minutes.

### Scoring, current version

| Factor | Points |
|---|---|
| Overdue | 400 |
| Today or tomorrow | 60 |
| This week | 30 |
| Soon | 12 |
| Ongoing | 6 |
| Has a deadline | plus 90 ÷ (days left + 1), plus 4 per hour of the high estimate |
| Committed to this day (Sometime lane, or rolled over) | plus 200 |

Waiting and decision items are never planned. A task due on the target day must end at least 15 minutes before its deadline.

### Block length

A task's block length is its sitting length if it has one, otherwise the low end of its estimate, otherwise 30 minutes. A block you resized keeps its length when re-planned.

### Reasons

Every penciled block records why it was placed ("Due Tue 2pm," "Not finished yesterday"). The details popover shows the reason.

### Automatic scheduling (a setting, off for now)

When on, a new task in Today or tomorrow, This week, or Overdue is penciled into the first free slot before its deadline (or within 1 or 6 days). Soon and Ongoing tasks are never placed automatically. When off, new tasks wait in the list until you press Plan or drag them in.

### Later

- Learn estimates from the "how long did it take?" answers.
- Split big tasks into sittings by their steps.
- Spread a week's work across days instead of filling the earliest slot.

## 13. Settings (gear button)

- **Your day:** usually up by (default 9am), usually asleep by (default 12am). This controls the folded hours and the planner's free time.
- **Look:** day or night, as Automatic (8pm to 8am is night), Day, or Night.
- **Time zone:** Automatic (from this device) or a specific zone. Home default is America/Chicago.
- **Planning:**
  - Schedule new tasks automatically (default off).
  - Weeks start on Sunday or Monday (default Sunday).
- **Weekly classes:** a list with Edit, plus "Add a weekly class." A class has a name, type, full name, days, start and end time, and location.
- **Categories:** rename, recolor custom ones, create new ones. Shows the task count for each.
- **Connections:**
  - Google Calendar (Connect).
  - Canvas calendar feed (paste the link).
- **Notifications:** each one can be switched on or off. Plus a test button.
  - Before each class (10 minutes before).
  - When a scheduled task starts.
  - Deadlines (the evening before and the morning of).
  - Morning summary.
  - Plan tomorrow (an hour before bedtime).
  - Check-in questions (at most once a day).

## 14. Integrations

### Google Calendar

The real build uses Google sign-in (OAuth) and the Google Calendar API. No file import.
- **Read:** show Google events on the schedule.
- **Optionally write:** send planned blocks to a "Planner" calendar.
- **Imported events:** shown in gray, and updated rather than duplicated on each sync.
- **Note for the build:** a Google Cloud project in "Testing" mode issues sign-ins that expire after 7 days for calendar access. Plan to publish the app for personal use.

### Canvas

Use the Calendar Feed link (Canvas, then Calendar, then Calendar Feed). It's a private iCal URL with assignments and events from all courses, about 366 days ahead and 30 days back. The server fetches it on a schedule.

Limits:
- Only items professors gave due dates.
- No submission status, files, or To Do items.
- Syllabus-only deadlines are missing.
- The link must stay private.

Personal access tokens are disabled for UChicago students, and OAuth needs a developer key from a Canvas admin. Asking UChicago's Canvas support is the only way to get more access. No workarounds.

### Notifications

Web push to the installed app. On iPhone this requires adding the app to the home screen first.

## 15. Lessons from the first attempt (keep)

- Planner logic in its own pure module with tests: no database, no network, and "now" passed in.
- Zod schemas shared between server and web.
- Durations as whole minutes, and Luxon for dates so daylight saving stays correct (DST ends November 1, 2026).
- An `AGENTS.md` with short rules: one step at a time, a plan before editing, never change a test's expected result to make it pass, run the checks before calling a step done.
- Small numbered steps in `PROGRESS.md`, committing after each.
- Its estimate-tracking ideas ("time left" answers, deadline status reasons) carry over.

## 16. Starting data

### Weekly classes

| Course | Type | Days | Time | Room |
|---|---|---|---|---|
| ECON 20010 | Lecture | Mon, Wed | 11:00am–12:20pm | Saieh Hall for Economics 021 |
| ECON 20010 | Discussion | Fri | 1:30–2:50pm | Saieh Hall for Economics 203 |
| MATH 15910 | Lecture | Mon, Wed, Fri | 12:30–1:20pm | Ryerson Phys Lab 255 |
| SOSC 16100 | Seminar | Tue, Thu | 2:00–3:20pm | Regenstein Library 207 |

Full names: The Elements of Economic Analysis I Honors; Introduction to Proofs in Analysis; Global Society I.

### Routines

- Morning routine: daily at 9am, 30 minutes.
- Meditate 10 min: daily.
- Gratitude, 5 things: daily, with a streak.
- Night routine and journal: daily at 11pm, 45 minutes.
- Laundry: every Saturday.
- Clean the dorm: every other Saturday, starting October 3.

### Tasks, from the October 1 todo

- **Read The Muqaddimah:** due Tue Oct 6 at 2pm. Steps are ch. 2, ch. 3 sections 1–15, and ch. 6 sections 34–37. Estimate 3–5h in 75-minute sittings.
- **Prep for the reading response:** due Tue Oct 6 at 2pm.
- **Get The Muqaddimah:** this week.
- **Math PSet 1:** due Wed Oct 7 at 11am. Steps are do the problems, then check answers with a friend.
- **Econ PSet 1:** due Fri Oct 9 at noon.
- **Shopping run:** small towels, razor, and shower mat (ask roommates about cost and who buys).
- **Clean the wooden container and store folders:** today or tomorrow.
- **Consolidate the quant plan:** today or tomorrow.
- **Waiting:**
  - Gym and boxing club, once the cold is gone.
  - ARCH reading, if accepted.
  - Resume and internship applications, once the QNet certificate arrives.
- **Decisions:** new blanket?, foam mattress topper?, skip econ discussion Friday?
- **Ongoing:** number theory book (45-minute sessions), the Epiphany ML project (1-hour sessions).
- **Events:** RSO fair, Fri Oct 2 at 3pm.

## 17. Not now

Native App Store apps, a writing feature for internship applications, two-way Canvas sync, scraping, shared or multi-user use, analytics charts.

## 18. Open questions

1. Phone week: one day per row, or a time grid you swipe sideways?
2. Which online host to use. Decided at the "go online" step.
3. Whether to keep the left rail's mini month and Coming up list, or use that space differently.
4. Whether Google Calendar should be read-only at first, or also receive planned blocks.

## Change log

- **Sep 25, 2026:** v0.1 (first attempt).
- **Oct 2, 2026:** v0.2. Rewritten from the brainstorm and prototypes 1–6.
- **Oct 2, 2026:** v0.3. Second-year student. Time zone setting and travel behavior. Tech stack decided.
