import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

# Point the app at a throwaway SQLite file BEFORE importing it.
_TMP_DB = os.path.join(tempfile.mkdtemp(prefix="gympulse-test-"), "test.db")
os.environ["DATABASE_URL"] = "sqlite:///" + _TMP_DB

import pytest  # noqa: E402

import analytics  # noqa: E402
import database as db  # noqa: E402
from app import app as flask_app  # noqa: E402


@pytest.fixture()
def client():
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as c:
        yield c
    # clean slate between tests
    db.execute("DELETE FROM exercises")
    db.execute("DELETE FROM session_muscles")
    db.execute("DELETE FROM sessions")
    db.execute("DELETE FROM measurements")


@pytest.fixture()
def seeded(client):
    payloads = [
        {"date": "2024-05-01", "status": "went", "muscles": ["Chest", "Triceps"],
         "start_time": "07:00", "end_time": "08:30", "workout_type": "Push", "energy": 8,
         "exercises": [{"name": "Bench Press", "sets": 4, "reps": 8, "weight": 60}]},
        {"date": "2024-05-02", "status": "went", "muscles": ["Back", "Biceps"],
         "start_time": "22:30", "end_time": "00:15",
         "exercises": [{"name": "Deadlift", "sets": 3, "reps": 5, "weight": 100}]},
        {"date": "2024-05-03", "status": "missed"},
        {"date": "2024-05-04", "status": "rest"},
    ]
    for p in payloads:
        res = client.post("/api/sessions", json=p)
        assert res.status_code == 201, res.get_json()
    return client
