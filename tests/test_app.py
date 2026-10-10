"""End-to-end tests for the Flask routes and persistence layer."""
import json

import analytics
import self_ping


def test_health(client):
    res = client.get("/health")
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] in ("ok", "degraded")
    assert body["application"] == "GymPulse AI"
    # must not leak secrets / private data
    assert "api_key" not in json.dumps(body).lower()
    assert "sessions" not in body


def test_pages_render(client):
    for path in ["/", "/calendar", "/history", "/progress", "/ai-coach", "/settings"]:
        res = client.get(path)
        assert res.status_code == 200, path
        assert b"GymPulse AI" in res.data


def test_unknown_route_returns_404_page(client):
    assert client.get("/does-not-exist").status_code == 404
    assert client.get("/api/does-not-exist").get_json()["error"]


def test_create_update_delete_session(client):
    res = client.post("/api/sessions", json={
        "date": "2024-06-10", "status": "went", "muscles": ["Legs", "Shoulders"],
        "start_time": "18:00", "end_time": "19:20", "energy": 7, "notes": "solid",
        "exercises": [{"name": "Squat", "sets": 5, "reps": 5, "weight": 80}]})
    assert res.status_code == 201
    sid = res.get_json()["id"]

    got = client.get("/api/sessions/%d" % sid).get_json()
    assert got["duration_min"] == 80
    assert got["muscles"] == ["Legs", "Shoulders"]
    assert got["exercises"][0]["name"] == "Squat"

    client.put("/api/sessions/%d" % sid, json={
        "date": "2024-06-10", "status": "went", "muscles": ["Legs"],
        "duration_min": 45, "exercises": []})
    got = client.get("/api/sessions/%d" % sid).get_json()
    assert got["duration_min"] == 45 and got["muscles"] == ["Legs"]

    assert client.delete("/api/sessions/%d" % sid).status_code == 200
    assert client.get("/api/sessions/%d" % sid).status_code == 404


def test_overnight_duration(seeded):
    sessions = seeded.get("/api/sessions?range=all").get_json()["sessions"]
    overnight = [s for s in sessions if s["date"] == "2024-05-02"][0]
    assert overnight["duration_min"] == 105  # 22:30 -> 00:15


def test_multiple_sessions_same_day(client):
    for start, end in (("07:00", "08:00"), ("18:00", "19:00")):
        res = client.post("/api/sessions", json={
            "date": "2024-07-01", "status": "went", "muscles": ["Chest"],
            "start_time": start, "end_time": end})
        assert res.status_code == 201
    day = client.get("/api/day/2024-07-01").get_json()
    assert len(day["sessions"]) == 2
    assert day["status"] == "went"


def test_duplicate_submission_blocked(client):
    body = {"date": "2024-07-02", "status": "went", "muscles": ["Back"], "duration_min": 50}
    assert client.post("/api/sessions", json=body).status_code == 201
    dup = client.post("/api/sessions", json=body)
    assert dup.status_code == 409
    assert dup.get_json()["duplicate"] is True


def test_validation_errors(client):
    assert client.post("/api/sessions", json={"date": "nope"}).status_code == 400
    assert client.post("/api/sessions", json={"date": "2024-07-03", "status": "flying"}).status_code == 400
    assert client.post("/api/sessions", json={"date": "2024-07-03", "start_time": "25:99"}).status_code == 400


def test_calendar_endpoint(seeded):
    data = seeded.get("/api/calendar?year=2024&month=5").get_json()
    assert data["label"] == "May 2024"
    assert len(data["days"]) == 31
    by_date = {d["date"]: d for d in data["days"]}
    assert by_date["2024-05-01"]["status"] == "went"
    assert by_date["2024-05-03"]["status"] == "missed"
    assert by_date["2024-05-04"]["status"] == "rest"
    assert by_date["2024-05-20"]["status"] in ("unrecorded", "future")
    assert by_date["2024-05-01"]["hindu"]["month"] in [
        "Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada",
        "Ashwin", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna"]


def test_charts_and_records(seeded):
    charts = seeded.get("/api/charts?range=all").get_json()
    assert charts["session_count"] == 2
    assert "Chest" in charts["muscle_labels"]
    records = seeded.get("/api/records").get_json()["records"]
    assert records[0]["exercise"] == "Deadlift"
    assert records[0]["estimated"] is True


def test_settings_roundtrip(client):
    res = client.post("/api/settings", json={"weekly_goal": 5, "calendar_system": "hindu"})
    assert res.status_code == 200
    settings = client.get("/api/settings").get_json()
    assert settings["weekly_goal"] == "5"
    assert settings["calendar_system"] == "hindu"
    assert "AI_API_KEY" not in settings and "ai_api_key" not in settings


def test_export_and_restore(seeded):
    csv_res = seeded.get("/api/export?format=csv")
    assert csv_res.status_code == 200 and b"Bench Press" in csv_res.data

    backup = seeded.get("/api/export?format=json").get_json()
    assert len(backup["sessions"]) == 4

    seeded.delete("/api/sessions/1")
    restore = seeded.post("/api/restore", json={"sessions": backup["sessions"], "replace": True})
    assert restore.status_code == 200
    assert restore.get_json()["imported_sessions"] == 4
    assert len(seeded.get("/api/sessions?range=all").get_json()["sessions"]) == 4


def test_ai_endpoint_is_honest_without_api_key(seeded):
    data = seeded.post("/api/ai/analyze", json={}).get_json()
    assert data["ai"]["used_ai"] is False
    assert data["source"] == "local analytics engine"
    assert len(data["insights"]) >= 3


def test_measurements(client):
    res = client.post("/api/measurements", json={"date": "2024-06-01", "body_weight": 72.5, "arms": 36})
    assert res.status_code == 201
    rows = client.get("/api/measurements").get_json()["measurements"]
    assert rows[0]["body_weight"] == 72.5


def test_self_ping_url_validation():
    ok, _ = self_ping.validate_url("https://YOUR-APP-NAME.onrender.com")
    assert ok is False
    ok, _ = self_ping.validate_url("not-a-url")
    assert ok is False
    ok, _ = self_ping.validate_url("https://gympulse.onrender.com")
    assert ok is True
    assert self_ping.health_url("https://x.onrender.com/") == "https://x.onrender.com/health"
    assert self_ping.health_url("https://x.onrender.com/health") == "https://x.onrender.com/health"
    assert self_ping.start("https://YOUR-APP-NAME.onrender.com", enabled=True).startswith("disabled")
    assert self_ping.start("https://x.onrender.com", enabled=False) == "disabled in configuration"


def test_persistence_across_app_instances(seeded):
    """Records live in the database, not in process memory."""
    assert len(analytics.load_sessions()) == 4
