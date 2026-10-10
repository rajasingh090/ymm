# GymPulse AI

A mobile-first, single-user gym journal and fitness analytics app built on the supplied **Next.js App Router + PostgreSQL + Drizzle ORM** project. It stores actual attendance and completed sessions, supports multiple sessions on one date, calculates progress from real records, and provides a Gregorian calendar with Panchangam-based Hindu lunar labels.

> **Architecture note:** the project scaffold provided for this build is Next.js/Drizzle/PostgreSQL. GymPulse AI therefore uses that stack rather than Flask, SQLite, or a Python `app.py`. `render.yaml` and `Procfile` are Node web-service deployment files. There is no `requirements.txt`; Python packages are not part of this application. This keeps the running application and deployment instructions consistent with the provided project.

## Features

- Daily attendance: **went**, **confirmed missed**, **planned rest**, or **not recorded**; future days are not missed automatically.
- Workout logger with flexible muscle combinations, forearms, multiple same-day sessions, optional times, duration, type, energy, notes, exercise names, sets, reps, weights, and rest intervals.
- Server-side validation, date indexes, transactions, cascade deletion, and a unique request token to prevent duplicate form submissions without blocking legitimate multiple sessions.
- Dashboard totals, actual seven-day sessions, monthly snapshot, gym-visit streaks, duration averages, attendance rate, recent sessions, and data-derived insights.
- Gregorian calendar and Hindu lunar month view using `@ishubhamx/panchangam-js`, with selectable **Amanta/Purnimanta** convention and editable location. Hindu dates are a display layer; saved workout dates remain unambiguous Gregorian dates.
- Searchable history, period-filtered Chart.js analytics, muscle frequency, attendance, duration, training volume, same-exercise progression, and clearly labelled estimated 1RM values.
- Deterministic progress analysis works without AI. Optional OpenAI-compatible explanation is server-side only and never exposes the key to the browser.
- Goals, saved muscle-combination shortcuts, optional measurements, CSV/JSON export, and merge-based JSON backup restore.
- Optional shared-password protection, PWA manifest, static-only service-worker caching, and configurable single-process health monitoring.

## Requirements

- Node.js 20.9+ (Render blueprint selects Node 22)
- PostgreSQL 14+ (local or managed cloud database)
- npm

The app deliberately uses PostgreSQL rather than silently falling back to an ephemeral local database. On Render, use a persistent managed PostgreSQL database. A Render free database may have a limited retention period; select a suitable paid/persistent plan for long-term records and configure backups.

## Local setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Create an empty PostgreSQL database, then expose its connection string to the app and Drizzle CLI. For example, in a shell:

   ```sh
   export DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/gympulse_ai'
   ```

   The app reads `DATABASE_URL` at runtime. No `.env` file is required by GymPulse-specific code. The starter repository may include its own local development environment file; do not commit database credentials.

3. Apply the checked-in, versioned schema migration:

   ```sh
   npx drizzle-kit migrate
   ```

   The migration creates the GymPulse tables and indexes. For future schema changes, update `src/db/schema.ts`, generate a reviewed migration with `npx drizzle-kit generate --name=describe_change`, and apply it with `npx drizzle-kit migrate`. Do not run `push --force` against a database containing user records.

4. Start the development app:

   ```sh
   npm run dev
   ```

   Open `http://localhost:3000`. `/api/health` returns a minimal application health JSON response.

## Render deployment

1. Push this repository to GitHub/GitLab.
2. In Render, choose **New → Blueprint**, select the repository, and apply `render.yaml`. The blueprint provisions a Node web service and a PostgreSQL database, links `DATABASE_URL`, applies the Drizzle migration during deploy, builds Next.js, and starts the production server with Gunicorn-free Node/Next startup on Render's `$PORT`.
3. Configure `GYMPULSE_ACCESS_PASSWORD` and a long random `GYMPULSE_AUTH_SECRET` in the Render service environment before entering personal workout records. The blueprint prompts for these values. They are optional for local work, but a public Render URL is not private without protection.
4. `GYMPULSE_AI_API_KEY` is optional. Leave it unset to use the fully functional deterministic local analysis. If set, `GYMPULSE_AI_MODEL` defaults to `gpt-4o-mini` and can be changed in Render's environment settings.
5. Render health checks use `/api/health`. The production process binds to `0.0.0.0` and respects Render's injected `$PORT`.

`render.yaml` uses a free plan as a quick-start example. Free Render services and database plans have platform limits and are not a 24/7 or permanent-storage promise. For long-lived workout history, use an appropriately persistent PostgreSQL plan, retain regular exports, and review the provider's current database retention policy.

### Schema migration on Render

The blueprint executes `npx drizzle-kit migrate` before `next build`, using the Render-managed `DATABASE_URL`. Migrations are versioned under `drizzle/`. For a change that alters existing columns, review the generated SQL before deploying and back up production data first. Do not use destructive schema auto-approval on production.

### Access protection

When both an access password and signing secret are configured, the app gates data APIs behind a signed, HttpOnly, SameSite cookie. Configure a long, unique password. Set `GYMPULSE_AUTH_SECRET` to a separate random secret (for example, generate one with `openssl rand -hex 32`). The health endpoint is public for platform checks but does not reveal database configuration. If both access settings are absent, GymPulse is open; that is suitable only for a trusted local network, not a public personal-data deployment.

## Source configuration and self-ping

Edit the clearly marked constants in [`src/lib/config.ts`](src/lib/config.ts):

```ts
export const SELF_PING_URL = ""; // paste your public service URL here
export const ENABLE_SELF_PING = false;
export const SELF_PING_INTERVAL_SECONDS = 600;
export const SELF_PING_TIMEOUT_SECONDS = 15;
```

Set the URL to your actual Render URL, then explicitly enable the monitor. The worker validates placeholder/invalid hostnames, appends `/api/health` safely, clamps the interval to at least five minutes, times out each request, avoids a second interval in the same Node process, logs failures without stopping the server, and clears its timer during shutdown. It runs in the Next Node instrumentation process, not in each request handler. Keep a single Render web instance if using the in-process monitor; disable it or use a dedicated external monitor if you scale to multiple processes/instances.

Self-pinging is for basic health monitoring only. **It does not guarantee that a Render free service stays awake or that it has 24/7 availability.** Render may spin a free service down, and requests to the same service are not a reliable way to prevent that. Continuous availability requires an appropriate hosting plan and/or an external monitoring service.

## Hindu calendar assumptions

- Library: `@ishubhamx/panchangam-js` (Swiss Ephemeris-backed Panchangam calculations).
- Default observer: Delhi, India, 28.6139° N, 77.2090° E, 216 m. The location is an explicit assumption, not geolocation; change latitude/longitude under **Settings → Calendar**.
- Default convention: Purnimanta; Amanta is also available.
- Time zone: `Asia/Kolkata` / UTC+05:30.
- Daily fields follow the library's sunrise convention for the selected observer and Gregorian day. Month boundaries are calculated from the library's selected convention; they are not mapped to the first day of Gregorian months.
- Regional panchang variations and observance rules can differ. Use the displayed convention/location context when comparing to a local almanac. Gregorian dates remain the stored source of truth.

## Analytics definitions

- **Workout session**: one saved completed session. Multiple sessions on one Gregorian date are allowed.
- **Gym visit**: a unique past date with at least one completed workout or an explicit `went` attendance record. A date is counted once even when multiple sessions exist.
- **Confirmed missed**: a past date explicitly marked `missed`, excluding any date with a completed session/visit. No blank/unrecorded date is counted as missed.
- **Planned rest**: a separate status; it is not a missed day.
- **Attendance rate**: attended dates ÷ (attended dates + confirmed missed dates). Planned rest, unrecorded dates, and future dates are excluded. If the denominator is zero, the rate is shown as unavailable.
- **Muscle frequency** counts only sessions with that muscle explicitly selected. Planned workouts and attendance-only dates do not affect it.
- **Duration** uses start/end times when both are supplied (end before/equal start is treated as crossing midnight). Otherwise the manual duration is used. A session contributes once.
- **Strength estimate** uses the Epley formula for recorded sets up to 15 reps; it is labelled an estimate and should only be compared for equivalent exercise names and conditions. It is not a tested max or training prescription.
- Attendance does not establish muscle growth, recovery, or medical status.

## PWA and offline behavior

The web manifest allows browsers such as Android Chrome to offer **Add to Home screen**. The service worker only caches versioned static assets, the manifest, and the icon. It intentionally does not queue offline workout writes: every save goes to the live server/database, avoiding hidden sync conflicts. Installing this PWA is not installing a native Android APK.

## Project map

```text
src/
  app/
    api/                 Health, auth, workout, attendance, analytics, export, backup
    page.tsx             GymPulse app entry point
    globals.css          Responsive dark/lime design system
  components/
    gympulse-app.tsx     Dashboard, calendar, history, navigation
    workout-modal.tsx    Workout logger/editor
    progress-view.tsx    Charts and local/optional AI coach
    settings-view.tsx    Goals, calendar, splits, measurements, privacy/data tools
  db/
    schema.ts            Drizzle PostgreSQL schema
    index.ts             PostgreSQL connection pool
  lib/
    config.ts            Source-editable self-ping settings
    self-ping.ts         Safe monitored health worker
    server/               Server-only auth and validation
  instrumentation.ts      Starts optional single-process monitor
  drizzle/                Versioned SQL migration and metadata
public/
  icon.svg
  sw.js                   Static-only caching service worker
render.yaml
Procfile
```

## API overview

- `GET /api/health` — public service health.
- `GET /api/auth`, `POST /api/auth`, `DELETE /api/auth` — optional access gate.
- `GET /api/data` — current user's records.
- `POST /api/sessions`, `PATCH/DELETE /api/sessions/:id` — completed sessions.
- `PUT /api/attendance` — attendance correction or clear/unrecorded status.
- `GET /api/calendar` — location/convention-aware Gregorian or Hindu lunar display data.
- `GET/POST /api/coach` — deterministic report and optional server-side AI explanation.
- `PUT /api/goals`, `PUT /api/settings`, `POST /api/measurements`, `POST /api/splits` — preferences and journals.
- `GET /api/export?format=csv|json`, `GET/POST /api/backup` — export and transactional merge restore.

## Troubleshooting

- **Database connection error:** confirm `DATABASE_URL` is reachable from the running Render service, and run the migration.
- **Render deploy cannot migrate:** check that the managed database is linked to the service and that its connection is reachable from the deploy environment. Preserve the same database across deploys.
- **Hindu dates differ from a local almanac:** confirm the selected Amanta/Purnimanta convention, latitude/longitude, and regional observance conventions.
- **AI Coach works but says AI is off:** this is expected until `GYMPULSE_AI_API_KEY` is configured. Deterministic analytics remain available.
- **Access password prompt does not appear:** configure both `GYMPULSE_ACCESS_PASSWORD` and `GYMPULSE_AUTH_SECRET`, then redeploy.
