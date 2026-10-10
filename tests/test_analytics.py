"""Tests for the local analytics engine, duration maths and Hindu calendar."""
from datetime import date

import analytics
import hindu_calendar
from app import compute_duration


def test_compute_duration_normal_and_overnight():
    assert compute_duration("07:00", "08:30", 0) == 90
    assert compute_duration("22:30", "00:15", 0) == 105      # crosses midnight
    assert compute_duration("07:00", "08:30", 45) == 45      # manual wins
    assert compute_duration("", "", 0) == 0


def test_streaks_ignores_unrecorded_and_respects_rest():
    statuses = {
        "2024-05-01": "went", "2024-05-02": "went", "2024-05-03": "rest",
        "2024-05-04": "went", "2024-05-06": "went",
    }
    s = analytics.streaks(statuses, date(2024, 5, 6))
    assert s["current"] == 1
    assert s["longest"] >= 2


def test_summary_counts(seeded):
    s = analytics.summary(date(2024, 5, 10), weekly_goal=4)
    assert s["total_sessions"] == 2
    assert s["total_gym_visits"] == 2
    assert s["total_missed_days"] == 1
    assert s["total_rest_days"] == 1
    # attendance = gym days / (gym days + confirmed missed days)
    assert s["attendance_pct"] == round(2 * 100 / 3, 1)
    assert s["total_minutes"] == 90 + 105


def test_muscle_stats(seeded):
    m = analytics.muscle_stats(date(2024, 5, 10))
    assert m["counts"]["all"]["Chest"] == 1
    assert m["counts"]["all"]["Biceps"] == 1
    assert m["days_since"]["Chest"] == 9
    assert m["days_since"]["Legs"] is None


def test_chart_data_shapes(seeded):
    data = analytics.chart_data("all", today=date(2024, 5, 10))
    assert data["session_count"] == 2
    assert sum(data["duration"]) == 195
    assert data["strength"][0]["exercise"] in ("Deadlift", "Bench Press")


def test_data_quality(seeded):
    q = analytics.data_quality(date(2024, 5, 10))
    assert q["logged_sessions"] == 2
    assert 0 <= q["completeness_pct"] <= 100


def test_hindu_calendar_is_a_real_computation():
    assert hindu_calendar.available() is True
    info = hindu_calendar.convert(date(2024, 3, 25))   # Holi / Phalguna Purnima
    assert info["month"] in hindu_calendar.MONTHS
    assert info["paksha"] in ("Shukla", "Krishna")
    assert 1 <= int(info["tithi"]) <= 15

    # Months must change across the year - not a renaming of Gregorian months.
    labels = {hindu_calendar.convert(date(2024, m, 15))["month"] for m in range(1, 13)}
    assert len(labels) >= 10

    # Known festival checks (verified panchanga dates):
    # Holi 2024 = Phalguna Shukla Purnima
    assert hindu_calendar.convert(date(2024, 3, 25))["label"] == "Phalguna Shukla Purnima"
    # Raksha Bandhan 2024 = Shravana Shukla Purnima
    assert hindu_calendar.convert(date(2024, 8, 19))["label"] == "Shravana Shukla Purnima"
    # Diwali 2024 (1 Nov) = Amavasya ending Ashwin (Amanta) / Kartika (Purnimanta)
    diwali = hindu_calendar.convert(date(2024, 11, 1), "amanta")
    assert diwali["month"] == "Ashwin" and diwali["tithi_name"] == "Amavasya"
    assert hindu_calendar.convert(date(2024, 11, 1), "purnimanta")["month"] == "Kartika"


def test_range_bounds():
    start, end = analytics.range_bounds("7d", date(2024, 5, 10))
    assert (end - start).days == 6
    start, end = analytics.range_bounds("all", date(2024, 5, 10))
    assert start is None
    start, end = analytics.range_bounds("custom", date(2024, 5, 10), "2024-01-01", "2024-02-01")
    assert start == date(2024, 1, 1) and end == date(2024, 2, 1)
