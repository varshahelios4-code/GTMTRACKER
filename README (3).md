# AI GTM Internship — Control Board

A single-page, no-backend tracker for your 5-objective AI GTM internship roadmap.

## What's inside

```
index.html              the app shell
styles.css              all styling (dark control-board theme)
app.js                  all logic — data loading, state, rendering
data/tasks_data.json    the single source of truth: all 103 tasks + 5 ongoing
                        practice-loop items, organized by objective
```

Everything about your roadmap (topics, resources, mini-projects, deliverables,
due dates, priority, estimated time) lives in `data/tasks_data.json`. Everything
about *your progress* (status, notes, reflections, completion timestamps) lives
in your browser's `localStorage` — nothing is sent anywhere, and nothing
requires a server.

## How the 5 objectives are scheduled

Per your instructions, objectives run **sequentially** — one finishes before
the next starts — in this order:

1. **Content Marketing** — two sub-tracks run *in parallel*: the 14-day
   Content & Channel roadmap and the 21-day SEO/GEO/AEO roadmap (21 weekdays
   total), plus an "Ongoing Practice Loop" (Phase 2) that unlocks after the
   Day-14 capstone and has no fixed due date — it's a recurring cadence, not
   a dated task.
2. **B2B Outreach & Communication** — 15 weekdays
3. **Automation & AI Agents** — 9 weekdays (2 mini-projects/day = 18 tasks)
4. **CRM & Marketing Operations** — 20 weekdays
5. **Marketing Analytics** — 15 weekdays

Day 1 across the whole roadmap is **Monday, August 3, 2026**, and one task
per weekday is scheduled per objective (business days only — weekends are
skipped). The last scheduled day is **Friday, November 20, 2026**.

### Assumptions worth knowing about
- **CRM roadmap**: the source file has no "Day 5" row (it jumps from Day 4 to
  Day 6, even though a later task references a "Day 5" ICP exercise). This is
  a gap in the original spreadsheet, not something introduced here — a note
  is attached to the task that follows it.
- **Estimated time**: where a source sheet didn't give a time estimate (CRM
  roadmap), a default of "3 hrs" was assumed to match the pace of the other
  roadmaps. Automation's two-mini-projects-per-day PDF didn't give per-project
  times either, so each was assumed at "1.5 hrs" (half of a normal 3-hour day).
- **Priority**: auto-tagged "High" for capstone/milestone/synthesis/wrap-up
  days, "Medium" otherwise — there was no explicit priority column in any
  source file.
- **Persistence**: this build uses `localStorage`, so progress is per
  browser/device (matches "no backend" in your spec). If you ever want
  progress to follow you across devices, that needs a small real backend
  (e.g. Supabase/Firebase free tier) — happy to wire that up if you want it
  later.

## Running it locally

Browsers block `fetch()` of local JSON files opened directly from disk
(`file://`), so you need to serve the folder over HTTP. Easiest option:

```bash
cd gtm-tracker
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Create a new GitHub repo (e.g. `gtm-internship-tracker`) and push this
   folder's contents to it (root of the repo, or a `/docs` folder — your
   call).
2. In the repo: **Settings → Pages → Build and deployment → Source** = "Deploy
   from a branch", pick `main` and `/ (root)` (or `/docs`).
3. Wait ~1 minute, then your tracker is live at
   `https://<your-username>.github.io/<repo-name>/`.

No build step, no dependencies to install — it's plain HTML/CSS/JS.

## Updating the roadmap later

Everything schedulable lives in `data/tasks_data.json` as a flat `tasks`
array (plus a small `ongoing` array for the Content Marketing practice loop).
Each task has the same shape:

```json
{
  "id": "cm-content-01",
  "objectiveId": "content-marketing",
  "subtrack": "content",
  "week": "Week 1",
  "day": 1,
  "topic": "...",
  "resources": "...",
  "miniProject": "...",
  "deliverable": "...",
  "status": "Not Started",
  "dueDate": "2026-08-03",
  "priority": "Medium",
  "estimatedTime": "3 hrs",
  "tools": null,
  "notes": "",
  "reflection": "",
  "reflectionPrompts": ["..."]
}
```

Add, remove, or re-date tasks by editing this file directly — the app reads
it fresh on every load. Your saved progress (status/notes/reflection) is
keyed by `id`, so as long as an id doesn't change, editing other fields on
that task won't wipe your progress on it.

## Resetting your progress

Open the browser console on the tracker page and run:
```js
localStorage.removeItem('gtmTrackerState_v1')
```
then reload.
