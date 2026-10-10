"""
GymPulse AI - local analytics engine.

Every number produced here comes from real rows in the database.  Nothing is
estimated unless it is explicitly labelled as an estimate.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import database as db

MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Forearms"]
PRIMARY_MUSCLES = MUSCLES[:6]
STATUSES = ["went", "missed", "rest"]

RANGES = {
    "7d": 7, "30d": 30, "90d": 90, "6m": 182, "12m": 365, "all": None,
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def parse_date(value: Any) -> Optional[date]:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def range_bounds(range_key: str, today: Optional[date] = None,
                 start: Optional[str] = None, end: Optional[str] = None
                 ) -> Tuple[Optional[date], date]:
    today = today or date.today()
    if range_key == "custom":
        s = parse_date(start)
        e = parse_date(end) or today
        return s, e
    days = RANGES.get(range_key, 30)
    if days is None:
        return None, today
    return today - timedelta(days=days - 1), today


# --------------------------------------------------------------------------
# data loading
# --------------------------------------------------------------------------
def load_sessions(start: Optional[date] = None, end: Optional[date] = None) -> List[Dict[str, Any]]:
    sql = "SELECT * FROM sessions"
    params: List[Any] = []
    clauses = []
    if start:
        clauses.append("day >= ?")
        params.append(start.isoformat())
    if end:
        clauses.append("day <= ?")
        params.append(end.isoformat())
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY day DESC, id DESC"
    sessions = db.query(sql, params)
    if not sessions:
        return []

    ids = [int(s["id"]) for s in sessions]
    muscles: Dict[int, List[str]] = defaultdict(list)
    exercises: Dict[int, List[Dict[str, Any]]] = defaultdict(list)
    for row in db.query("SELECT * FROM session_muscles"):
        if int(row["session_id"]) in ids:
            muscles[int(row["session_id"])].append(row["muscle"])
    for row in db.query("SELECT * FROM exercises ORDER BY id"):
        if int(row["session_id"]) in ids:
            exercises[int(row["session_id"])].append({
                "id": int(row["id"]),
                "name": row["name"],
                "muscle": row.get("muscle"),
                "sets": int(row["sets"] or 0),
                "reps": int(row["reps"] or 0),
                "weight": float(row["weight"] or 0),
                "notes": row.get("notes") or "",
                "volume": int(row["sets"] or 0) * int(row["reps"] or 0) * float(row["weight"] or 0),
            })

    out = []
    for s in sessions:
        sid = int(s["id"])
        out.append({
            "id": sid,
            "date": str(s["day"])[:10],
            "status": s["status"],
            "start_time": s.get("start_time") or "",
            "end_time": s.get("end_time") or "",
            "duration_min": int(s["duration_min"] or 0),
            "workout_type": s.get("workout_type") or "",
            "energy": s.get("energy"),
            "notes": s.get("notes") or "",
            "created_at": s.get("created_at"),
            "muscles": sorted(muscles.get(sid, [])),
            "exercises": exercises.get(sid, []),
        })
    return out


def day_status_map(sessions: List[Dict[str, Any]]) -> Dict[str, str]:
    """Best status per calendar day: went > rest > missed."""
    priority = {"went": 3, "rest": 2, "missed": 1}
    result: Dict[str, str] = {}
    for s in sessions:
        cur = result.get(s["date"])
        if cur is None or priority.get(s["status"], 0) > priority.get(cur, 0):
            result[s["date"]] = s["status"]
    return result


# --------------------------------------------------------------------------
# core statistics
# --------------------------------------------------------------------------
def streaks(statuses: Dict[str, str], today: Optional[date] = None) -> Dict[str, int]:
    today = today or date.today()
    gym_days = sorted(d for d, st in statuses.items() if st == "went")
    if not gym_days:
        return {"current": 0, "longest": 0}

    longest = 1
    run = 1
    for i in range(1, len(gym_days)):
        prev = parse_date(gym_days[i - 1])
        cur = parse_date(gym_days[i])
        if prev and cur and (cur - prev).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1

    # Current streak: consecutive gym days ending today or yesterday.
    current = 0
    cursor = today
    if statuses.get(cursor.isoformat()) != "went":
        cursor = today - timedelta(days=1)
    while True:
        st = statuses.get(cursor.isoformat())
        if st == "went":
            current += 1
            cursor -= timedelta(days=1)
        elif st == "rest":
            cursor -= timedelta(days=1)  # a planned rest day does not break a streak
        else:
            break
    return {"current": current, "longest": max(longest, current)}


def summary(today: Optional[date] = None, weekly_goal: int = 4) -> Dict[str, Any]:
    today = today or date.today()
    all_sessions = load_sessions()
    statuses = day_status_map(all_sessions)

    went = [s for s in all_sessions if s["status"] == "went"]
    gym_days = {s["date"] for s in went}
    missed_days = {d for d, st in statuses.items() if st == "missed"}
    rest_days = {d for d, st in statuses.items() if st == "rest"}

    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    weekly_sessions = [s for s in went if parse_date(s["date"]) and parse_date(s["date"]) >= week_start]  # type: ignore
    monthly_sessions = [s for s in went if parse_date(s["date"]) and parse_date(s["date"]) >= month_start]  # type: ignore

    total_minutes = sum(s["duration_min"] for s in went)
    durations = [s["duration_min"] for s in went if s["duration_min"] > 0]

    first_day = min((parse_date(s["date"]) for s in all_sessions), default=None) if all_sessions else None
    tracked_days = (today - first_day).days + 1 if first_day else 0
    recorded_days = len([d for d in statuses if (parse_date(d) or today) <= today])
    unrecorded_days = max(tracked_days - recorded_days, 0)

    # Attendance % = gym days / (gym days + confirmed missed days).
    denominator = len(gym_days) + len(missed_days)
    attendance_pct = round(len(gym_days) * 100.0 / denominator, 1) if denominator else 0.0

    weeks_tracked = max(tracked_days / 7.0, 1 / 7.0) if tracked_days else 0
    avg_per_week = round(len(went) / weeks_tracked, 2) if weeks_tracked else 0.0

    st = streaks(statuses, today)
    return {
        "today": today.isoformat(),
        "total_gym_visits": len(gym_days),
        "total_sessions": len(went),
        "total_missed_days": len(missed_days),
        "total_rest_days": len(rest_days),
        "unrecorded_days": unrecorded_days,
        "tracked_days": tracked_days,
        "weekly_sessions": len(weekly_sessions),
        "monthly_sessions": len(monthly_sessions),
        "weekly_goal": weekly_goal,
        "weekly_goal_pct": min(round(len(weekly_sessions) * 100.0 / weekly_goal, 0), 100) if weekly_goal else 0,
        "attendance_pct": attendance_pct,
        "current_streak": st["current"],
        "longest_streak": st["longest"],
        "total_hours": round(total_minutes / 60.0, 1),
        "total_minutes": total_minutes,
        "avg_duration": round(sum(durations) / len(durations), 0) if durations else 0,
        "avg_sessions_per_week": avg_per_week,
        "first_recorded": first_day.isoformat() if first_day else None,
        "total_volume": round(sum(e["volume"] for s in went for e in s["exercises"]), 0),
        "exercise_entries": sum(len(s["exercises"]) for s in went),
    }


def muscle_stats(today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    sessions = [s for s in load_sessions() if s["status"] == "went"]
    periods = {"7d": 7, "30d": 30, "90d": 90, "6m": 182, "all": None}

    counts: Dict[str, Dict[str, int]] = {p: {m: 0 for m in MUSCLES} for p in periods}
    last_trained: Dict[str, Optional[str]] = {m: None for m in MUSCLES}

    for s in sessions:
        d = parse_date(s["date"])
        if not d:
            continue
        age = (today - d).days
        for m in s["muscles"]:
            if m not in counts["all"]:
                for p in periods:
                    counts[p].setdefault(m, 0)
                last_trained.setdefault(m, None)
            for p, days in periods.items():
                if days is None or 0 <= age < days:
                    counts[p][m] = counts[p].get(m, 0) + 1
            if last_trained.get(m) is None or s["date"] > str(last_trained[m]):
                last_trained[m] = s["date"]

    days_since = {}
    for m, dt in last_trained.items():
        pd = parse_date(dt)
        days_since[m] = (today - pd).days if pd else None

    neglected = sorted(
        [m for m in PRIMARY_MUSCLES],
        key=lambda m: (-(days_since[m] if days_since[m] is not None else 9999), counts["30d"].get(m, 0)),
    )
    return {
        "muscles": sorted(set(MUSCLES) | set(counts["all"].keys())),
        "counts": counts,
        "last_trained": last_trained,
        "days_since": days_since,
        "neglected": neglected[:3],
    }


# --------------------------------------------------------------------------
# chart series
# --------------------------------------------------------------------------
def chart_data(range_key: str = "30d", start: Optional[str] = None,
               end: Optional[str] = None, today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    s_date, e_date = range_bounds(range_key, today, start, end)
    sessions = load_sessions(s_date, e_date)
    went = [s for s in sessions if s["status"] == "went"]
    statuses = day_status_map(sessions)

    if s_date is None:
        s_date = min((parse_date(s["date"]) for s in sessions), default=today) or today

    # Daily duration series
    daily: Dict[str, int] = defaultdict(int)
    for s in went:
        daily[s["date"]] += s["duration_min"]

    days: List[str] = []
    cursor = s_date
    while cursor <= e_date:
        days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    if len(days) > 400:  # keep payloads light on mobile
        days = days[-400:]

    duration_series = [daily.get(d, 0) for d in days]

    # Weekly sessions / attendance
    weekly: Dict[str, Dict[str, int]] = defaultdict(lambda: {"went": 0, "missed": 0, "rest": 0})
    for d_str, st in statuses.items():
        d = parse_date(d_str)
        if not d:
            continue
        wk = (d - timedelta(days=d.weekday())).isoformat()
        weekly[wk][st] = weekly[wk].get(st, 0) + 1
    week_labels = sorted(weekly.keys())
    weekly_sessions = [weekly[w]["went"] for w in week_labels]

    # Monthly attendance percentage
    monthly: Dict[str, Dict[str, int]] = defaultdict(lambda: {"went": 0, "missed": 0})
    for d_str, st in statuses.items():
        key = d_str[:7]
        if st == "went":
            monthly[key]["went"] += 1
        elif st == "missed":
            monthly[key]["missed"] += 1
    month_labels = sorted(monthly.keys())
    monthly_pct = []
    for m in month_labels:
        tot = monthly[m]["went"] + monthly[m]["missed"]
        monthly_pct.append(round(monthly[m]["went"] * 100.0 / tot, 1) if tot else 0)

    # Muscle frequency
    muscle_counter: Counter = Counter()
    for s in went:
        muscle_counter.update(s["muscles"])
    muscle_labels = [m for m in MUSCLES if muscle_counter.get(m)] + \
                    [m for m in muscle_counter if m not in MUSCLES]
    muscle_values = [muscle_counter[m] for m in muscle_labels]

    # Training volume per week
    volume_weekly: Dict[str, float] = defaultdict(float)
    for s in went:
        d = parse_date(s["date"])
        if not d:
            continue
        wk = (d - timedelta(days=d.weekday())).isoformat()
        volume_weekly[wk] += sum(e["volume"] for e in s["exercises"])
    volume_labels = sorted(volume_weekly.keys())

    # Strength progression per exercise (top heaviest set per day)
    strength: Dict[str, Dict[str, float]] = defaultdict(dict)
    for s in went:
        for e in s["exercises"]:
            key = e["name"].strip().title()
            if not key or e["weight"] <= 0:
                continue
            strength[key][s["date"]] = max(strength[key].get(s["date"], 0), e["weight"])
    strength_series = []
    for name, points in sorted(strength.items(), key=lambda kv: -len(kv[1]))[:5]:
        ordered = sorted(points.items())
        strength_series.append({
            "exercise": name,
            "labels": [p[0] for p in ordered],
            "values": [p[1] for p in ordered],
        })

    return {
        "range": range_key,
        "start": s_date.isoformat(),
        "end": e_date.isoformat(),
        "days": days,
        "duration": duration_series,
        "weeks": week_labels,
        "weekly_sessions": weekly_sessions,
        "weekly_went": [weekly[w]["went"] for w in week_labels],
        "weekly_missed": [weekly[w]["missed"] for w in week_labels],
        "weekly_rest": [weekly[w]["rest"] for w in week_labels],
        "months": month_labels,
        "monthly_pct": monthly_pct,
        "muscle_labels": muscle_labels,
        "muscle_values": muscle_values,
        "volume_labels": volume_labels,
        "volume_values": [round(volume_weekly[w], 1) for w in volume_labels],
        "strength": strength_series,
        "session_count": len(went),
    }


def personal_records(limit: int = 12) -> List[Dict[str, Any]]:
    rows = db.query(
        "SELECT e.name AS name, e.weight AS weight, e.reps AS reps, e.sets AS sets, "
        "s.day AS day FROM exercises e JOIN sessions s ON s.id = e.session_id "
        "WHERE e.weight > 0 ORDER BY e.weight DESC"
    )
    best: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        key = str(r["name"]).strip().title()
        if key not in best:
            est = float(r["weight"]) * (1 + int(r["reps"] or 0) / 30.0)  # Epley estimate
            best[key] = {
                "exercise": key,
                "weight": float(r["weight"]),
                "reps": int(r["reps"] or 0),
                "sets": int(r["sets"] or 0),
                "date": str(r["day"])[:10],
                "estimated_1rm": round(est, 1),
                "estimated": True,
            }
    return sorted(best.values(), key=lambda x: -x["weight"])[:limit]


def heatmap(year: int) -> Dict[str, Any]:
    sessions = load_sessions(date(year, 1, 1), date(year, 12, 31))
    statuses = day_status_map(sessions)
    minutes: Dict[str, int] = defaultdict(int)
    for s in sessions:
        if s["status"] == "went":
            minutes[s["date"]] += s["duration_min"]
    return {"year": year, "statuses": statuses, "minutes": minutes}


def data_quality(today: Optional[date] = None) -> Dict[str, Any]:
    today = today or date.today()
    sessions = load_sessions()
    went = [s for s in sessions if s["status"] == "went"]
    missing_duration = len([s for s in went if not s["duration_min"]])
    missing_muscles = len([s for s in went if not s["muscles"]])
    missing_exercises = len([s for s in went if not s["exercises"]])
    total = len(went) or 1
    score = 100 - round((missing_duration + missing_muscles + missing_exercises) * 100.0 / (3 * total))
    return {
        "logged_sessions": len(went),
        "missing_duration": missing_duration,
        "missing_muscles": missing_muscles,
        "missing_exercises": missing_exercises,
        "completeness_pct": max(score, 0),
    }


def measurements() -> List[Dict[str, Any]]:
    rows = db.query("SELECT * FROM measurements ORDER BY day DESC, id DESC")
    return [{
        "id": int(r["id"]),
        "date": str(r["day"])[:10],
        "body_weight": r.get("body_weight"),
        "chest": r.get("chest"),
        "waist": r.get("waist"),
        "arms": r.get("arms"),
        "thighs": r.get("thighs"),
        "notes": r.get("notes") or "",
    } for r in rows]
