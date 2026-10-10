"""
GymPulse AI - Flask application entry point.

Run locally:      python app.py
Run in production: gunicorn app:app  (Render uses the Procfile / render.yaml)
"""

from __future__ import annotations

# ==========================================
# GYMPULSE AI CONFIGURATION
# (edit everything you need right here - no .env file is used)
# ==========================================

APP_NAME = "GymPulse AI"

# Paste the actual Render URL here after deployment.
SELF_PING_URL = "https://YOUR-APP-NAME.onrender.com"

# Self-ping configuration
ENABLE_SELF_PING = True          # ignored if the URL above is still a placeholder
SELF_PING_INTERVAL = 600         # seconds between health checks (minimum 60)
SELF_PING_TIMEOUT = 15           # seconds before an individual request is abandoned

# Database configuration
# Empty  -> SQLite file (gympulse.db) for local development.
# Filled -> PostgreSQL connection URL, e.g.
#           "postgresql://user:password@host:5432/dbname"
DATABASE_URL = ""

# AI configuration (optional - the whole app works with ENABLE_AI = False)
ENABLE_AI = False
AI_API_KEY = ""                                  # never sent to the browser
AI_MODEL = "gpt-4o-mini"
AI_BASE_URL = "https://api.openai.com/v1"        # any OpenAI-compatible endpoint

# Application timezone
APP_TIMEZONE = "Asia/Kolkata"

# Personal application settings
DEFAULT_WEEKLY_GOAL = 4
DEFAULT_MONTHLY_GOAL = 16
DEFAULT_CALENDAR_SYSTEM = "gregorian"            # "gregorian" or "hindu"
DEFAULT_HINDU_CONVENTION = "amanta"              # "amanta" or "purnimanta"

# Optional single-user password protection.
# Empty string = no login required (keep it empty only for local use!).
APP_PASSWORD = ""
SECRET_KEY = "gympulse-ai-change-this-secret-key"

# ==========================================
# END OF CONFIGURATION
# ==========================================

import csv
import io
import json
import logging
import os
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from typing import Any, Dict, List, Optional, Tuple

from flask import (Flask, Response, abort, jsonify, redirect, render_template,
                   request, session, url_for)

import ai_coach
import analytics
import database as db
import hindu_calendar
import self_ping

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("gympulse")

try:
    from zoneinfo import ZoneInfo
    _TZ = ZoneInfo(APP_TIMEZONE)
except Exception:  # pragma: no cover
    _TZ = timezone(timedelta(hours=5, minutes=30))

DEFAULT_SETTINGS = {
    "weekly_goal": str(DEFAULT_WEEKLY_GOAL),
    "monthly_goal": str(DEFAULT_MONTHLY_GOAL),
    "calendar_system": DEFAULT_CALENDAR_SYSTEM,
    "hindu_convention": DEFAULT_HINDU_CONVENTION,
    "weight_unit": "kg",
    "custom_splits": json.dumps([
        {"name": "Push", "muscles": ["Chest", "Shoulders", "Triceps"]},
        {"name": "Pull", "muscles": ["Back", "Biceps", "Forearms"]},
        {"name": "Legs", "muscles": ["Legs"]},
        {"name": "Arms", "muscles": ["Biceps", "Triceps"]},
    ]),
}


def today_local() -> date:
    return datetime.now(_TZ).date()


def now_iso() -> str:
    return datetime.now(_TZ).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# validation helpers
# --------------------------------------------------------------------------
class ValidationError(Exception):
    pass


def v_date(value: Any, field: str = "date") -> str:
    parsed = analytics.parse_date(value)
    if not parsed:
        raise ValidationError(f"'{field}' must be a valid YYYY-MM-DD date.")
    if parsed.year < 2000 or parsed.year > 2100:
        raise ValidationError(f"'{field}' is outside the supported range.")
    return parsed.isoformat()


def v_status(value: Any) -> str:
    value = str(value or "went").strip().lower()
    if value not in analytics.STATUSES:
        raise ValidationError("status must be one of: went, missed, rest.")
    return value


def v_time(value: Any) -> str:
    value = str(value or "").strip()
    if not value:
        return ""
    try:
        datetime.strptime(value, "%H:%M")
    except ValueError:
        raise ValidationError("Times must use the HH:MM format.")
    return value


def v_int(value: Any, field: str, lo: int = 0, hi: int = 100000) -> int:
    if value in (None, "", []):
        return 0
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        raise ValidationError(f"'{field}' must be a number.")
    if not (lo <= number <= hi):
        raise ValidationError(f"'{field}' must be between {lo} and {hi}.")
    return number


def v_float(value: Any, field: str, lo: float = 0, hi: float = 2000) -> float:
    if value in (None, "", []):
        return 0.0
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValidationError(f"'{field}' must be a number.")
    if not (lo <= number <= hi):
        raise ValidationError(f"'{field}' must be between {lo} and {hi}.")
    return round(number, 2)


def v_text(value: Any, field: str, maxlen: int = 2000) -> str:
    text = ("" if value is None else str(value)).strip()
    if len(text) > maxlen:
        raise ValidationError(f"'{field}' is too long (max {maxlen} characters).")
    return text


def compute_duration(start: str, end: str, manual: int) -> int:
    """Automatic duration with overnight support; manual value wins if given."""
    if manual:
        return manual
    if start and end:
        s = datetime.strptime(start, "%H:%M")
        e = datetime.strptime(end, "%H:%M")
        delta = (e - s).total_seconds() / 60.0
        if delta <= 0:
            delta += 24 * 60  # workout crossed midnight
        return int(round(delta))
    return 0


# --------------------------------------------------------------------------
# application factory
# --------------------------------------------------------------------------
def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = SECRET_KEY
    app.config["JSON_SORT_KEYS"] = False
    app.config["TEMPLATES_AUTO_RELOAD"] = False

    db.configure(os.environ.get("DATABASE_URL", "") or DATABASE_URL)
    db.init_db(DEFAULT_SETTINGS)
    log.info("Storage backend: %s", db.describe()["backend"])

    register_routes(app)
    return app


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if APP_PASSWORD and not session.get("authenticated"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required."}), 401
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapper


def get_settings() -> Dict[str, str]:
    stored = DEFAULT_SETTINGS.copy()
    try:
        stored.update(db.get_settings())
    except Exception as exc:  # pragma: no cover
        log.error("Could not read settings: %s", exc)
    return stored


def setting_int(key: str, fallback: int) -> int:
    try:
        return int(get_settings().get(key, fallback))
    except (TypeError, ValueError):
        return fallback


def base_context() -> Dict[str, Any]:
    settings = get_settings()
    today = today_local()
    hindu = hindu_calendar.safe_convert(today, settings.get("hindu_convention", "amanta"))
    return {
        "app_name": APP_NAME,
        "settings": settings,
        "today": today.isoformat(),
        "today_pretty": today.strftime("%A, %d %B %Y"),
        "gregorian_month": today.strftime("%B %Y"),
        "hindu": hindu,
        "hindu_available": hindu is not None,
        "ai_enabled": bool(ENABLE_AI and AI_API_KEY and AI_MODEL),
        "muscles": analytics.MUSCLES,
    }


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------
def register_routes(app: Flask) -> None:

    # ---------------- pages ----------------
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if not APP_PASSWORD:
            return redirect(url_for("dashboard"))
        error = ""
        if request.method == "POST":
            if request.form.get("password", "") == APP_PASSWORD:
                session["authenticated"] = True
                session.permanent = True
                nxt = request.args.get("next") or url_for("dashboard")
                return redirect(nxt if nxt.startswith("/") else url_for("dashboard"))
            error = "Incorrect password."
        return render_template("login.html", app_name=APP_NAME, error=error)

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("login") if APP_PASSWORD else url_for("dashboard"))

    @app.route("/")
    @login_required
    def dashboard():
        ctx = base_context()
        stats = analytics.summary(today_local(), setting_int("weekly_goal", DEFAULT_WEEKLY_GOAL))
        recent = analytics.load_sessions()[:6]
        hour = datetime.now(_TZ).hour
        greeting = ("Good morning" if hour < 12 else
                    "Good afternoon" if hour < 17 else
                    "Good evening" if hour < 22 else "Late night grind")
        return render_template("index.html", greeting=greeting, stats=stats,
                               recent=recent, **ctx)

    @app.route("/calendar")
    @login_required
    def calendar_page():
        return render_template("calendar.html", **base_context())

    @app.route("/history")
    @login_required
    def history_page():
        return render_template("history.html", **base_context())

    @app.route("/progress")
    @login_required
    def progress_page():
        return render_template("progress.html", **base_context())

    @app.route("/ai-coach")
    @login_required
    def ai_coach_page():
        return render_template("ai_coach.html", **base_context())

    @app.route("/settings")
    @login_required
    def settings_page():
        ctx = base_context()
        return render_template(
            "settings.html",
            storage=db.describe(),
            self_ping_status=app.config.get("SELF_PING_STATUS", "not started"),
            hindu_method=hindu_calendar.method(),
            timezone_name=APP_TIMEZONE,
            password_protected=bool(APP_PASSWORD),
            **ctx,
        )

    @app.route("/sw.js")
    def service_worker():
        from flask import send_from_directory
        response = send_from_directory(app.static_folder, "sw.js")
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Content-Type"] = "application/javascript"
        return response

    # ---------------- health ----------------
    @app.route("/health")
    def health():
        """Public health check - never exposes secrets or private records."""
        return jsonify({
            "status": "ok" if db.healthy() else "degraded",
            "application": APP_NAME,
            "database": db.describe()["backend"],
            "time": now_iso(),
        })

    # ---------------- API: sessions ----------------
    @app.get("/api/summary")
    @login_required
    def api_summary():
        today = today_local()
        goal = setting_int("weekly_goal", DEFAULT_WEEKLY_GOAL)
        return jsonify({
            "summary": analytics.summary(today, goal),
            "muscles": analytics.muscle_stats(today),
            "quality": analytics.data_quality(today),
        })

    @app.get("/api/sessions")
    @login_required
    def api_sessions():
        range_key = request.args.get("range", "all")
        start, end = analytics.range_bounds(range_key, today_local(),
                                            request.args.get("start"),
                                            request.args.get("end"))
        sessions = analytics.load_sessions(start, end)
        search = (request.args.get("q") or "").strip().lower()
        muscle = (request.args.get("muscle") or "").strip()
        wtype = (request.args.get("type") or "").strip().lower()
        status = (request.args.get("status") or "").strip().lower()
        min_dur = request.args.get("min_duration", type=int)

        def matches(s: Dict[str, Any]) -> bool:
            if muscle and muscle not in s["muscles"]:
                return False
            if wtype and wtype not in (s["workout_type"] or "").lower():
                return False
            if status and s["status"] != status:
                return False
            if min_dur and s["duration_min"] < min_dur:
                return False
            if search:
                haystack = " ".join([
                    s["date"], s["notes"], s["workout_type"] or "",
                    " ".join(s["muscles"]),
                    " ".join(e["name"] for e in s["exercises"]),
                ]).lower()
                if search not in haystack:
                    return False
            return True

        return jsonify({"sessions": [s for s in sessions if matches(s)]})

    @app.get("/api/sessions/<int:session_id>")
    @login_required
    def api_session(session_id: int):
        for s in analytics.load_sessions():
            if s["id"] == session_id:
                return jsonify(s)
        return jsonify({"error": "Session not found."}), 404

    def _payload() -> Dict[str, Any]:
        data = request.get_json(silent=True)
        if data is None:
            data = request.form.to_dict(flat=True)
        if not isinstance(data, dict):
            raise ValidationError("Invalid request body.")
        return data

    def _clean_session(data: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str], List[Dict[str, Any]]]:
        day = v_date(data.get("date"), "date")
        status = v_status(data.get("status"))
        start = v_time(data.get("start_time"))
        end = v_time(data.get("end_time"))
        manual = v_int(data.get("duration_min"), "duration_min", 0, 1440)
        duration = compute_duration(start, end, manual) if status == "went" else 0
        energy_raw = data.get("energy")
        energy = v_int(energy_raw, "energy", 0, 10) if energy_raw not in (None, "") else None

        muscles_raw = data.get("muscles") or []
        if isinstance(muscles_raw, str):
            muscles_raw = [m for m in muscles_raw.split(",") if m.strip()]
        muscles: List[str] = []
        for m in muscles_raw:
            name = v_text(m, "muscle", 40).title()
            if name and name not in muscles:
                muscles.append(name)
        if status != "went":
            muscles = []

        exercises: List[Dict[str, Any]] = []
        for raw in (data.get("exercises") or []):
            if not isinstance(raw, dict):
                continue
            name = v_text(raw.get("name"), "exercise name", 80)
            if not name:
                continue
            exercises.append({
                "name": name,
                "muscle": v_text(raw.get("muscle"), "muscle", 40),
                "sets": v_int(raw.get("sets"), "sets", 0, 100),
                "reps": v_int(raw.get("reps"), "reps", 0, 1000),
                "weight": v_float(raw.get("weight"), "weight", 0, 1000),
                "notes": v_text(raw.get("notes"), "exercise notes", 300),
            })
        if status != "went":
            exercises = []

        payload = {
            "day": day, "status": status, "start_time": start, "end_time": end,
            "duration_min": duration,
            "workout_type": v_text(data.get("workout_type"), "workout_type", 60),
            "energy": energy,
            "notes": v_text(data.get("notes"), "notes", 2000),
        }
        return payload, muscles, exercises

    @app.post("/api/sessions")
    @login_required
    def api_create_session():
        try:
            data = _payload()
            payload, muscles, exercises = _clean_session(data)
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400

        # Duplicate guard: same day/status/start/duration saved in the last 60s.
        recent = db.query(
            "SELECT id, created_at FROM sessions WHERE day = ? AND status = ? "
            "AND COALESCE(start_time,'') = ? AND duration_min = ? ORDER BY id DESC",
            (payload["day"], payload["status"], payload["start_time"], payload["duration_min"]),
        )
        if recent and not data.get("force"):
            try:
                created = datetime.fromisoformat(str(recent[0]["created_at"]))
                if (datetime.now(_TZ) - created).total_seconds() < 60:
                    return jsonify({"error": "Duplicate submission ignored.",
                                    "id": int(recent[0]["id"]), "duplicate": True}), 409
            except Exception:
                pass

        try:
            with db.transaction() as tx:
                sid = tx.insert(
                    "INSERT INTO sessions (day, status, start_time, end_time, duration_min, "
                    "workout_type, energy, notes, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (payload["day"], payload["status"], payload["start_time"], payload["end_time"],
                     payload["duration_min"], payload["workout_type"], payload["energy"],
                     payload["notes"], now_iso(), now_iso()),
                )
                for m in muscles:
                    tx.execute("INSERT INTO session_muscles (session_id, muscle) VALUES (?, ?)", (sid, m))
                for e in exercises:
                    tx.execute(
                        "INSERT INTO exercises (session_id, name, muscle, sets, reps, weight, notes) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (sid, e["name"], e["muscle"], e["sets"], e["reps"], e["weight"], e["notes"]),
                    )
        except Exception as exc:
            log.exception("Could not save session")
            return jsonify({"error": f"Database error: {exc.__class__.__name__}"}), 500
        return jsonify({"ok": True, "id": sid}), 201

    @app.put("/api/sessions/<int:session_id>")
    @login_required
    def api_update_session(session_id: int):
        existing = db.query_one("SELECT id FROM sessions WHERE id = ?", (session_id,))
        if not existing:
            return jsonify({"error": "Session not found."}), 404
        try:
            payload, muscles, exercises = _clean_session(_payload())
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        try:
            with db.transaction() as tx:
                tx.execute(
                    "UPDATE sessions SET day=?, status=?, start_time=?, end_time=?, duration_min=?, "
                    "workout_type=?, energy=?, notes=?, updated_at=? WHERE id=?",
                    (payload["day"], payload["status"], payload["start_time"], payload["end_time"],
                     payload["duration_min"], payload["workout_type"], payload["energy"],
                     payload["notes"], now_iso(), session_id),
                )
                tx.execute("DELETE FROM session_muscles WHERE session_id = ?", (session_id,))
                tx.execute("DELETE FROM exercises WHERE session_id = ?", (session_id,))
                for m in muscles:
                    tx.execute("INSERT INTO session_muscles (session_id, muscle) VALUES (?, ?)",
                               (session_id, m))
                for e in exercises:
                    tx.execute(
                        "INSERT INTO exercises (session_id, name, muscle, sets, reps, weight, notes) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (session_id, e["name"], e["muscle"], e["sets"], e["reps"], e["weight"], e["notes"]),
                    )
        except Exception:
            log.exception("Could not update session")
            return jsonify({"error": "Database error while updating the session."}), 500
        return jsonify({"ok": True, "id": session_id})

    @app.delete("/api/sessions/<int:session_id>")
    @login_required
    def api_delete_session(session_id: int):
        with db.transaction() as tx:
            tx.execute("DELETE FROM exercises WHERE session_id = ?", (session_id,))
            tx.execute("DELETE FROM session_muscles WHERE session_id = ?", (session_id,))
            tx.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        return jsonify({"ok": True})

    # ---------------- API: calendar ----------------
    @app.get("/api/calendar")
    @login_required
    def api_calendar():
        today = today_local()
        year = request.args.get("year", type=int) or today.year
        month = request.args.get("month", type=int) or today.month
        if not (1 <= month <= 12) or not (2000 <= year <= 2100):
            return jsonify({"error": "Invalid year or month."}), 400
        convention = get_settings().get("hindu_convention", "amanta")

        first = date(year, month, 1)
        last = date(year + (month == 12), (month % 12) + 1, 1) - timedelta(days=1)
        sessions = analytics.load_sessions(first, last)
        statuses = analytics.day_status_map(sessions)

        days = []
        cursor = first
        while cursor <= last:
            iso = cursor.isoformat()
            day_sessions = [s for s in sessions if s["date"] == iso]
            status = statuses.get(iso)
            if status is None:
                status = "future" if cursor > today else "unrecorded"
            hindu = hindu_calendar.safe_convert(cursor, convention)
            days.append({
                "date": iso,
                "day": cursor.day,
                "weekday": cursor.weekday(),
                "status": status,
                "sessions": day_sessions,
                "duration": sum(s["duration_min"] for s in day_sessions if s["status"] == "went"),
                "muscles": sorted({m for s in day_sessions for m in s["muscles"]}),
                "hindu": hindu,
            })
            cursor += timedelta(days=1)

        hindu_first = hindu_calendar.safe_convert(first, convention)
        hindu_last = hindu_calendar.safe_convert(last, convention)
        return jsonify({
            "year": year, "month": month,
            "label": first.strftime("%B %Y"),
            "hindu_label": (f"{hindu_first['month']} - {hindu_last['month']}"
                            if hindu_first and hindu_last and hindu_first["month"] != hindu_last["month"]
                            else (hindu_first["month"] if hindu_first else None)),
            "hindu_available": hindu_first is not None,
            "hindu_method": hindu_calendar.method(),
            "hindu_convention": convention,
            "first_weekday": first.weekday(),
            "days": days,
            "today": today.isoformat(),
        })

    @app.get("/api/day/<day>")
    @login_required
    def api_day(day: str):
        try:
            iso = v_date(day)
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        d = analytics.parse_date(iso)
        sessions = analytics.load_sessions(d, d)
        status = analytics.day_status_map(sessions).get(iso)
        if status is None:
            status = "future" if d and d > today_local() else "unrecorded"
        return jsonify({
            "date": iso, "status": status, "sessions": sessions,
            "hindu": hindu_calendar.safe_convert(d, get_settings().get("hindu_convention", "amanta")),
        })

    # ---------------- API: analytics ----------------
    @app.get("/api/charts")
    @login_required
    def api_charts():
        return jsonify(analytics.chart_data(
            request.args.get("range", "30d"),
            request.args.get("start"),
            request.args.get("end"),
            today_local(),
        ))

    @app.get("/api/records")
    @login_required
    def api_records():
        return jsonify({"records": analytics.personal_records(20)})

    @app.get("/api/heatmap")
    @login_required
    def api_heatmap():
        year = request.args.get("year", type=int) or today_local().year
        return jsonify(analytics.heatmap(year))

    @app.get("/api/muscles")
    @login_required
    def api_muscles():
        return jsonify(analytics.muscle_stats(today_local()))

    # ---------------- API: measurements ----------------
    @app.get("/api/measurements")
    @login_required
    def api_measurements():
        return jsonify({"measurements": analytics.measurements()})

    @app.post("/api/measurements")
    @login_required
    def api_add_measurement():
        try:
            data = _payload()
            row = (
                v_date(data.get("date"), "date"),
                v_float(data.get("body_weight"), "body_weight", 0, 500) or None,
                v_float(data.get("chest"), "chest", 0, 300) or None,
                v_float(data.get("waist"), "waist", 0, 300) or None,
                v_float(data.get("arms"), "arms", 0, 100) or None,
                v_float(data.get("thighs"), "thighs", 0, 150) or None,
                v_text(data.get("notes"), "notes", 500),
            )
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        mid = db.insert_returning_id(
            "INSERT INTO measurements (day, body_weight, chest, waist, arms, thighs, notes) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", row)
        return jsonify({"ok": True, "id": mid}), 201

    @app.delete("/api/measurements/<int:mid>")
    @login_required
    def api_delete_measurement(mid: int):
        db.execute("DELETE FROM measurements WHERE id = ?", (mid,))
        return jsonify({"ok": True})

    # ---------------- API: settings ----------------
    @app.get("/api/settings")
    @login_required
    def api_get_settings():
        s = get_settings()
        s_public = {k: v for k, v in s.items()}          # app_settings never holds secrets
        s_public["storage"] = db.describe()["backend"]
        s_public["ai_enabled"] = bool(ENABLE_AI and AI_API_KEY and AI_MODEL)
        s_public["hindu_available"] = hindu_calendar.available()
        return jsonify(s_public)

    @app.post("/api/settings")
    @login_required
    def api_set_settings():
        allowed = {"weekly_goal", "monthly_goal", "calendar_system",
                   "hindu_convention", "weight_unit", "custom_splits"}
        try:
            data = _payload()
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400
        for key, value in data.items():
            if key not in allowed:
                continue
            if key in ("weekly_goal", "monthly_goal"):
                value = str(v_int(value, key, 0, 31))
            elif key == "calendar_system":
                value = "hindu" if str(value).lower() == "hindu" else "gregorian"
            elif key == "hindu_convention":
                value = "purnimanta" if str(value).lower().startswith("p") else "amanta"
            elif key == "custom_splits":
                if not isinstance(value, str):
                    value = json.dumps(value)
                try:
                    json.loads(value)
                except Exception:
                    return jsonify({"error": "custom_splits must be valid JSON."}), 400
            else:
                value = v_text(value, key, 100)
            db.set_setting(key, str(value))
        return jsonify({"ok": True, "settings": get_settings()})

    # ---------------- API: export / backup ----------------
    @app.get("/api/export")
    @login_required
    def api_export():
        fmt = (request.args.get("format") or "json").lower()
        sessions = analytics.load_sessions()
        if fmt == "csv":
            buf = io.StringIO()
            writer = csv.writer(buf)
            writer.writerow(["date", "status", "start_time", "end_time", "duration_min",
                             "workout_type", "energy", "muscles", "exercise", "sets",
                             "reps", "weight", "notes"])
            for s in sessions:
                if s["exercises"]:
                    for e in s["exercises"]:
                        writer.writerow([s["date"], s["status"], s["start_time"], s["end_time"],
                                         s["duration_min"], s["workout_type"], s["energy"],
                                         "|".join(s["muscles"]), e["name"], e["sets"], e["reps"],
                                         e["weight"], s["notes"]])
                else:
                    writer.writerow([s["date"], s["status"], s["start_time"], s["end_time"],
                                     s["duration_min"], s["workout_type"], s["energy"],
                                     "|".join(s["muscles"]), "", "", "", "", s["notes"]])
            return Response(buf.getvalue(), mimetype="text/csv", headers={
                "Content-Disposition": f"attachment; filename=gympulse-{today_local()}.csv"})
        payload = {
            "application": APP_NAME,
            "exported_at": now_iso(),
            "version": 1,
            "sessions": sessions,
            "measurements": analytics.measurements(),
            "settings": get_settings(),
        }
        return Response(json.dumps(payload, indent=2, default=str), mimetype="application/json",
                        headers={"Content-Disposition":
                                 f"attachment; filename=gympulse-backup-{today_local()}.json"})

    @app.post("/api/restore")
    @login_required
    def api_restore():
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or "sessions" not in data:
            return jsonify({"error": "Invalid backup file: a 'sessions' list is required."}), 400
        replace = bool(data.get("replace", True))
        imported = 0
        try:
            with db.transaction() as tx:
                if replace:
                    tx.execute("DELETE FROM exercises")
                    tx.execute("DELETE FROM session_muscles")
                    tx.execute("DELETE FROM sessions")
                    tx.execute("DELETE FROM measurements")
                for raw in data.get("sessions", []):
                    if not isinstance(raw, dict):
                        continue
                    try:
                        payload, muscles, exercises = _clean_session(raw)
                    except ValidationError:
                        continue
                    sid = tx.insert(
                        "INSERT INTO sessions (day, status, start_time, end_time, duration_min, "
                        "workout_type, energy, notes, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (payload["day"], payload["status"], payload["start_time"],
                         payload["end_time"], payload["duration_min"], payload["workout_type"],
                         payload["energy"], payload["notes"], now_iso(), now_iso()))
                    for m in muscles:
                        tx.execute("INSERT INTO session_muscles (session_id, muscle) VALUES (?, ?)",
                                   (sid, m))
                    for e in exercises:
                        tx.execute(
                            "INSERT INTO exercises (session_id, name, muscle, sets, reps, weight, notes) "
                            "VALUES (?, ?, ?, ?, ?, ?, ?)",
                            (sid, e["name"], e["muscle"], e["sets"], e["reps"], e["weight"], e["notes"]))
                    imported += 1
                for raw in data.get("measurements", []) or []:
                    if not isinstance(raw, dict):
                        continue
                    try:
                        day = v_date(raw.get("date"), "date")
                    except ValidationError:
                        continue
                    tx.execute(
                        "INSERT INTO measurements (day, body_weight, chest, waist, arms, thighs, notes) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (day, raw.get("body_weight"), raw.get("chest"), raw.get("waist"),
                         raw.get("arms"), raw.get("thighs"), str(raw.get("notes") or "")[:500]))
        except Exception:
            log.exception("Restore failed")
            return jsonify({"error": "Restore failed - the backup was rolled back."}), 500
        return jsonify({"ok": True, "imported_sessions": imported, "replaced": replace})

    # ---------------- API: AI coach ----------------
    @app.post("/api/ai/analyze")
    @login_required
    def api_ai_analyze():
        report = ai_coach.build_report(setting_int("weekly_goal", DEFAULT_WEEKLY_GOAL), today_local())
        narrative = ai_coach.ai_narrative(
            report, enabled=bool(ENABLE_AI), api_key=AI_API_KEY,
            model=AI_MODEL, base_url=AI_BASE_URL)
        return jsonify({
            "generated_at": now_iso(),
            "insights": report["insights"],
            "summary": report["summary"],
            "muscles": report["muscles"],
            "quality": report["quality"],
            "records": report["records"],
            "ai": {"used_ai": narrative["used_ai"], "reason": narrative["reason"],
                   "text": narrative["text"]},
            "source": "AI narrative + local analytics" if narrative["used_ai"] else "local analytics engine",
        })

    # ---------------- errors ----------------
    @app.errorhandler(404)
    def not_found(_e):
        if request.path.startswith("/api/"):
            return jsonify({"error": "Not found."}), 404
        return render_template("404.html", **base_context()), 404

    @app.errorhandler(500)
    def server_error(_e):  # pragma: no cover
        if request.path.startswith("/api/"):
            return jsonify({"error": "Internal server error."}), 500
        return render_template("404.html", **base_context()), 500


app = create_app()

# --------------------------------------------------------------------------
# self-ping bootstrap (safe for multi-worker Gunicorn: file-lock guarded)
# --------------------------------------------------------------------------
app.config["SELF_PING_STATUS"] = self_ping.start(
    SELF_PING_URL, enabled=ENABLE_SELF_PING,
    interval=SELF_PING_INTERVAL, timeout=SELF_PING_TIMEOUT)
log.info("Self-ping: %s", app.config["SELF_PING_STATUS"])


if __name__ == "__main__":
    # Local development only - Render/production uses Gunicorn (see Procfile).
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
