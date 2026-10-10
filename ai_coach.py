"""
GymPulse AI - two-layer coach.

Layer 1 (always on):  a deterministic local analytics engine that turns the
                      real database numbers into honest, plain statements.
Layer 2 (optional):   an AI API that rewrites those numbers as natural
                      language.  It is only used when ENABLE_AI is True and a
                      key is configured.  The key never leaves the server.

If AI is disabled the response clearly states that the analysis is local -
the app never pretends a model was used.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List

import analytics

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore


# --------------------------------------------------------------------------
# layer 1 - local analytics
# --------------------------------------------------------------------------
def build_report(weekly_goal: int = 4, today: date | None = None) -> Dict[str, Any]:
    today = today or date.today()
    s = analytics.summary(today, weekly_goal)
    m = analytics.muscle_stats(today)
    q = analytics.data_quality(today)
    prs = analytics.personal_records(5)
    charts = analytics.chart_data("90d", today=today)

    insights: List[Dict[str, str]] = []

    if s["total_sessions"] == 0:
        insights.append({
            "type": "info",
            "title": "No workouts recorded yet",
            "body": "Log your first session and the coach will start analysing real data. "
                    "Nothing here is estimated or invented.",
        })
        return {"summary": s, "muscles": m, "quality": q, "records": prs, "insights": insights}

    insights.append({
        "type": "attendance",
        "title": f"{s['total_sessions']} sessions across {s['total_gym_visits']} gym days",
        "body": (f"Attendance is {s['attendance_pct']}% of confirmed days "
                 f"({s['total_gym_visits']} went vs {s['total_missed_days']} missed). "
                 f"{s['unrecorded_days']} days are unrecorded and are excluded from that "
                 "percentage - an unrecorded day is not counted as a skipped day."),
    })

    insights.append({
        "type": "streak",
        "title": f"Current streak: {s['current_streak']} day(s)",
        "body": (f"Your longest recorded streak is {s['longest_streak']} day(s). "
                 f"Average training frequency is {s['avg_sessions_per_week']} sessions per week "
                 f"against a goal of {weekly_goal}."),
    })

    if s["weekly_sessions"] >= weekly_goal:
        insights.append({"type": "good", "title": "Weekly goal reached",
                         "body": f"{s['weekly_sessions']} sessions this week (goal {weekly_goal})."})
    else:
        insights.append({"type": "warn", "title": "Weekly goal in progress",
                         "body": f"{s['weekly_sessions']} of {weekly_goal} sessions logged this week."})

    stale = [(mu, d) for mu, d in m["days_since"].items()
             if mu in analytics.PRIMARY_MUSCLES and (d is None or d >= 10)]
    if stale:
        parts = [f"{mu} ({'never logged' if d is None else str(d) + ' days ago'})" for mu, d in stale]
        insights.append({"type": "warn", "title": "Muscle groups you are neglecting",
                         "body": "Not trained recently: " + ", ".join(parts) + "."})
    else:
        insights.append({"type": "good", "title": "Balanced muscle coverage",
                         "body": "Every primary muscle group was trained within the last 10 days."})

    counts30 = m["counts"]["30d"]
    if any(counts30.values()):
        top = max(counts30, key=lambda k: counts30[k])
        low = min(analytics.PRIMARY_MUSCLES, key=lambda k: counts30.get(k, 0))
        insights.append({"type": "muscles", "title": "30-day distribution",
                         "body": f"Most trained: {top} ({counts30[top]}x). "
                                 f"Least trained: {low} ({counts30.get(low, 0)}x)."})

    if prs:
        pr = prs[0]
        insights.append({"type": "strength", "title": f"Heaviest logged lift: {pr['exercise']}",
                         "body": (f"{pr['weight']} kg x {pr['reps']} reps on {pr['date']}. "
                                  f"Estimated 1RM {pr['estimated_1rm']} kg (Epley formula - an estimate, "
                                  "not a measured max).")})
    else:
        insights.append({"type": "info", "title": "No strength data yet",
                         "body": "Add exercises with sets, reps and weight to unlock strength analysis."})

    if charts["volume_values"] and len(charts["volume_values"]) >= 2:
        last, prev = charts["volume_values"][-1], charts["volume_values"][-2]
        if prev > 0:
            delta = round((last - prev) * 100.0 / prev, 1)
            insights.append({"type": "volume", "title": "Weekly training volume",
                             "body": f"Last week {last} kg-reps vs {prev} the week before ({delta:+}%)."})

    insights.append({
        "type": "info", "title": "Honesty note",
        "body": ("Attendance and volume numbers describe training consistency only. "
                 "They do not prove muscle growth - log body measurements and body weight "
                 f"for physical progress. Data completeness: {q['completeness_pct']}%."),
    })

    return {"summary": s, "muscles": m, "quality": q, "records": prs, "insights": insights}


# --------------------------------------------------------------------------
# layer 2 - optional AI narrative
# --------------------------------------------------------------------------
def ai_narrative(report: Dict[str, Any], *, enabled: bool, api_key: str,
                 model: str, base_url: str, timeout: int = 30) -> Dict[str, Any]:
    if not enabled or not api_key or not model:
        return {"used_ai": False,
                "reason": "AI is disabled in the configuration - showing local analytics only.",
                "text": ""}
    if requests is None:  # pragma: no cover
        return {"used_ai": False, "reason": "The 'requests' library is not installed.", "text": ""}

    facts = {
        "summary": report["summary"],
        "muscle_counts_30d": report["muscles"]["counts"]["30d"],
        "days_since_muscle": report["muscles"]["days_since"],
        "records": report["records"],
        "data_quality": report["quality"],
    }
    prompt = (
        "You are a careful strength-training coach. Using ONLY the JSON facts below, "
        "write a short, motivating but strictly honest progress review (max 200 words). "
        "Never invent workouts or claim muscle growth from attendance alone. "
        "Mention one concrete action for next week.\n\n"
        + json.dumps(facts, default=str)
    )
    try:
        resp = requests.post(
            base_url.rstrip("/") + "/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": model, "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0.4, "max_tokens": 400},
            timeout=timeout,
        )
        if resp.status_code >= 400:
            return {"used_ai": False,
                    "reason": f"AI provider returned HTTP {resp.status_code}.", "text": ""}
        data = resp.json()
        text = data["choices"][0]["message"]["content"].strip()
        return {"used_ai": True, "reason": "", "text": text}
    except Exception as exc:  # pragma: no cover - network dependent
        return {"used_ai": False, "reason": f"AI request failed: {exc.__class__.__name__}.", "text": ""}
