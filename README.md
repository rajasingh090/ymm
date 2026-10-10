# GymPulse AI — personal gym tracker (Python + Flask)

A mobile-first, futuristic gym tracker that records **real** attendance, muscle groups,
sessions, exercises, duration, notes and optional body measurements — with Gregorian **and**
Hindu lunar calendar support, Chart.js analytics and an honest two-layer AI coach.

No React, no Node, no build step: **Flask + Jinja2 + HTML + CSS + vanilla JS + Chart.js**.

---

## 1. Features

| Area | What you get |
|---|---|
| Dashboard | Time-based greeting, Gregorian + Hindu month, visits, weekly/monthly sessions, hours, attendance %, streaks, animated counters, 3 live charts, recent workouts, coach insight |
| Logger | Animated modal: date, status, muscle groups, start/end time, auto duration (overnight safe), manual duration, type, energy, unlimited exercises (sets/reps/weight), notes, save/edit/delete, duplicate-submission guard, multiple sessions per day |
| Attendance | Went / Did not go / Planned rest / Not recorded — colour coded; future days never marked missed |
| Calendar | Month grid with Gregorian ⇄ Hindu lunar switch (Amanta/Purnimanta), tithi + paksha, tap a day for details and editing, month summary |
| History | Search + filters (text, muscle, status, range, min duration), yearly heatmap, personal records with clearly-labelled estimated 1RM |
| Progress | 6 Chart.js charts, range filters (7d/30d/90d/6m/12m/all/custom), muscle coverage table, body measurements, CSV + JSON export, JSON restore |
| AI Coach | Layer 1 local Python analytics (always available) + Layer 2 optional AI narrative |
| Platform | `/health` endpoint, optional self-ping worker, SQLite + PostgreSQL, PWA manifest + service worker, optional password login, pytest suite |

## 2. Project structure

```
gympulse-ai/
├── app.py              # configuration block + Flask app, routes, JSON API
├── database.py         # SQLite / PostgreSQL layer, schema init, transactions
├── analytics.py        # statistics engine (attendance, muscles, charts, PRs)
├── ai_coach.py         # local insight generator + optional AI narrative
├── hindu_calendar.py   # panchanga conversion (Meeus + Lahiri ayanamsha)
├── self_ping.py        # optional, single-instance health pinger
├── requirements.txt / Procfile / render.yaml
├── templates/          # base, index, calendar, history, progress, ai_coach, settings, login, 404
├── static/css/style.css
├── static/js/          # app, workout, charts, dashboard, calendar, history, progress, coach, settings
├── static/icons/icon.svg, static/manifest.json, static/sw.js
└── tests/              # test_app.py, test_analytics.py, conftest.py
```

## 3. Run locally

```bash
cd gympulse-ai
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py            # http://localhost:5000  (dev server)
# production-style:
gunicorn app:app --bind 0.0.0.0:5000
pytest -q                # 24 tests
```

SQLite file `gympulse.db` is created automatically next to `app.py`.

## 4. Configuration (no `.env` file)

Everything lives in the clearly marked block at the top of **`app.py`**:

```python
APP_NAME, SELF_PING_URL, ENABLE_SELF_PING, SELF_PING_INTERVAL, SELF_PING_TIMEOUT,
DATABASE_URL, ENABLE_AI, AI_API_KEY, AI_MODEL, AI_BASE_URL, APP_TIMEZONE,
DEFAULT_WEEKLY_GOAL, DEFAULT_MONTHLY_GOAL, DEFAULT_CALENDAR_SYSTEM,
DEFAULT_HINDU_CONVENTION, APP_PASSWORD, SECRET_KEY
```

* The listening port is **never hardcoded** — Gunicorn binds `0.0.0.0:$PORT` supplied by Render.
* `DATABASE_URL` may also be supplied by Render as an environment variable; the env value wins,
  otherwise the value written in `app.py` is used.
* The AI key stays on the server. It is never rendered into a template or returned by an API.

> ⚠️ **Security warning:** putting an API key or password directly in source code is less secure
> than a secret manager. Never commit a real key to a public GitHub repository. Prefer Render's
> *Environment* secrets (read them with `os.environ`) for anything sensitive.

## 5. Deploy to Render

1. Push this folder to GitHub.
2. Render → **New +** → **Blueprint** → select the repo (`render.yaml` is detected).
   It creates the web service **and** a free PostgreSQL database and wires `DATABASE_URL`.
   *Manual alternative:* New Web Service → Runtime **Python** → Root directory `gympulse-ai` →
   Build `pip install -r requirements.txt` →
   Start `gunicorn app:app --bind 0.0.0.0:$PORT --workers 1 --threads 4`.
3. Health check path: `/health`.
4. Copy the live URL (e.g. `https://gympulse-ai.onrender.com`) into `SELF_PING_URL` in `app.py`
   if you want the optional monitor, then redeploy.

### Persistent database (important)

Render's filesystem is ephemeral — a SQLite file is **lost on every redeploy**.
For real persistence create a PostgreSQL instance (the blueprint does it for you) and either:

* let Render inject `DATABASE_URL` (recommended), or
* paste the *External Database URL* into `DATABASE_URL` inside `app.py`.

Tables are created automatically on boot (`db.init_db()` is idempotent, so it doubles as a
simple migration step). The app uses PostgreSQL **consistently** when a URL is configured and
logs the active backend at startup; the Settings page shows which backend is live.

## 6. Self-ping — honest notes

* Disabled automatically when `SELF_PING_URL` still contains `YOUR-APP-NAME`, is not an
  absolute http(s) URL, or points at localhost (a warning is logged).
* One worker only: an exclusive `flock` lock file guarantees a single thread even with
  multiple Gunicorn workers; the blueprint also runs `--workers 1 --threads 4`.
* Sequential loop, finite timeout, errors swallowed, status logged only when it changes,
  `/health` appended only if not already present, stops cleanly via a `threading.Event`.
* **Self-pinging does not guarantee a free Render service stays awake.** Render may still sleep
  free instances and self-originated traffic may not count. For real monitoring use an external
  service (UptimeRobot, Better Stack, cron-job.org) pointed at `https://your-app/health`.

## 7. Hindu calendar

`hindu_calendar.py` computes the lunar month, paksha and tithi from astronomical formulas
(Meeus *Astronomical Algorithms* for solar/lunar longitudes + Lahiri ayanamsha for the sidereal
solar sign at the new moon). Months are therefore real conversions, not renamed Gregorian months —
verified against known dates (Holi 2024 = Phalguna Shukla Purnima, Raksha Bandhan 2024 =
Shravana Shukla Purnima, Diwali 2024 = Ashwin Amavasya / Kartika in Purnimanta).
Both **Amanta** and **Purnimanta** conventions are selectable in Settings.
If an external panchanga library is installed it is used instead; if conversion ever fails the UI
falls back to Gregorian and says so. **Every workout is stored with a Gregorian ISO date.**

## 8. Privacy & security

* Set `APP_PASSWORD` in `app.py` before exposing the public URL — otherwise anyone with the URL
  can read your records. With it set, every page and API route requires a session login
  (only `/health` stays public, and it exposes no private data).
* All input is validated server-side; every SQL statement is parameterised; writes run in
  transactions; database errors return clean JSON instead of stack traces.

## 9. API reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | `{"status":"ok","application":"GymPulse AI",...}` |
| GET/POST | `/api/sessions` | list (filters) / create |
| GET/PUT/DELETE | `/api/sessions/<id>` | read / update / delete |
| GET | `/api/day/<YYYY-MM-DD>` | one day with sessions + panchanga |
| GET | `/api/calendar?year=&month=` | month grid with statuses |
| GET | `/api/summary`, `/api/muscles`, `/api/charts`, `/api/records`, `/api/heatmap` | analytics |
| GET/POST | `/api/measurements`, `/api/settings` | body data / preferences |
| GET | `/api/export?format=csv\|json` | export & backup |
| POST | `/api/restore` | restore a JSON backup (transactional) |
| POST | `/api/ai/analyze` | coach report (local always, AI optional) |

## 10. Tests

```bash
pytest -q      # 24 tests: routes, CRUD, overnight duration, duplicates, multi-session days,
               # calendar, attendance maths, streaks, exports/restore, panchanga, self-ping config
```
