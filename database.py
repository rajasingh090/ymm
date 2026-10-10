"""
GymPulse AI - database access layer.

Supports SQLite (local development) and PostgreSQL (production / Render).
All queries are written with "?" placeholders and translated automatically
for the PostgreSQL driver.  Every query is parameterised - no string
interpolation of user data anywhere.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional, Sequence

try:  # Optional - only needed when a PostgreSQL URL is configured
    import psycopg
    from psycopg.rows import dict_row

    HAS_PSYCOPG = True
except Exception:  # pragma: no cover - psycopg missing in local dev
    psycopg = None  # type: ignore
    dict_row = None  # type: ignore
    HAS_PSYCOPG = False


_state: Dict[str, Any] = {
    "backend": "sqlite",
    "sqlite_path": os.path.join(os.path.dirname(os.path.abspath(__file__)), "gympulse.db"),
    "dsn": "",
}
_lock = threading.Lock()


# --------------------------------------------------------------------------
# configuration / connection
# --------------------------------------------------------------------------
def configure(database_url: str = "", sqlite_path: Optional[str] = None) -> str:
    """Select the backend.  Returns the active backend name."""
    url = (database_url or "").strip()
    if sqlite_path:
        _state["sqlite_path"] = sqlite_path

    if url and url.startswith(("postgres://", "postgresql://")):
        if not HAS_PSYCOPG:
            raise RuntimeError(
                "A PostgreSQL DATABASE_URL is configured but the 'psycopg' driver "
                "is not installed.  Add psycopg[binary] to requirements.txt."
            )
        # psycopg 3 understands postgresql:// ; normalise the legacy scheme.
        if url.startswith("postgres://"):
            url = "postgresql://" + url[len("postgres://"):]
        _state["dsn"] = url
        _state["backend"] = "postgresql"
    elif url.startswith("sqlite:///"):
        _state["sqlite_path"] = url[len("sqlite:///"):]
        _state["backend"] = "sqlite"
    else:
        _state["backend"] = "sqlite"
    return _state["backend"]


def backend() -> str:
    return _state["backend"]


def describe() -> Dict[str, Any]:
    """Safe description of the storage backend (never leaks credentials)."""
    if _state["backend"] == "postgresql":
        return {"backend": "postgresql", "location": "managed PostgreSQL server"}
    return {"backend": "sqlite", "location": os.path.basename(_state["sqlite_path"])}


def _translate(sql: str) -> str:
    if _state["backend"] == "postgresql":
        # "?" -> "%s" (no literal strings containing "?" are used in this app)
        return re.sub(r"\?", "%s", sql)
    return sql


@contextmanager
def connection():
    if _state["backend"] == "postgresql":
        conn = psycopg.connect(_state["dsn"], row_factory=dict_row, autocommit=False)  # type: ignore
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    else:
        path = _state["sqlite_path"]
        directory = os.path.dirname(os.path.abspath(path))
        if directory and not os.path.isdir(directory):
            os.makedirs(directory, exist_ok=True)
        conn = sqlite3.connect(path, timeout=20)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def query(sql: str, params: Sequence[Any] = ()) -> List[Dict[str, Any]]:
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_translate(sql), tuple(params))
        rows = cur.fetchall()
        return [dict(r) for r in rows]


def query_one(sql: str, params: Sequence[Any] = ()) -> Optional[Dict[str, Any]]:
    rows = query(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Sequence[Any] = ()) -> int:
    """Execute a statement, returning the affected row count."""
    with connection() as conn:
        cur = conn.cursor()
        cur.execute(_translate(sql), tuple(params))
        return cur.rowcount if cur.rowcount is not None else 0


def insert_returning_id(sql: str, params: Sequence[Any] = ()) -> int:
    """INSERT helper that returns the new primary key on both backends."""
    with connection() as conn:
        cur = conn.cursor()
        if _state["backend"] == "postgresql":
            cur.execute(_translate(sql + " RETURNING id"), tuple(params))
            row = cur.fetchone()
            return int(row["id"])  # type: ignore[index]
        cur.execute(sql, tuple(params))
        return int(cur.lastrowid)


@contextmanager
def transaction():
    """Explicit multi-statement transaction (used by restore/backup)."""
    with connection() as conn:
        cur = conn.cursor()

        class Tx:
            def execute(self, sql: str, params: Sequence[Any] = ()) -> None:
                cur.execute(_translate(sql), tuple(params))

            def insert(self, sql: str, params: Sequence[Any] = ()) -> int:
                if _state["backend"] == "postgresql":
                    cur.execute(_translate(sql + " RETURNING id"), tuple(params))
                    row = cur.fetchone()
                    return int(row["id"])  # type: ignore[index]
                cur.execute(sql, tuple(params))
                return int(cur.lastrowid)

            def fetchall(self, sql: str, params: Sequence[Any] = ()) -> List[Dict[str, Any]]:
                cur.execute(_translate(sql), tuple(params))
                return [dict(r) for r in cur.fetchall()]

        yield Tx()


# --------------------------------------------------------------------------
# schema
# --------------------------------------------------------------------------
SQLITE_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'went',
        start_time TEXT,
        end_time TEXT,
        duration_min INTEGER NOT NULL DEFAULT 0,
        workout_type TEXT,
        energy INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS session_muscles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        muscle TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        muscle TEXT,
        sets INTEGER NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        weight REAL NOT NULL DEFAULT 0,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS measurements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        body_weight REAL,
        chest REAL,
        waist REAL,
        arms REAL,
        thighs REAL,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day)",
    "CREATE INDEX IF NOT EXISTS idx_muscles_session ON session_muscles(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_exercises_session ON exercises(session_id)",
]

PG_SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        day TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'went',
        start_time TEXT,
        end_time TEXT,
        duration_min INTEGER NOT NULL DEFAULT 0,
        workout_type TEXT,
        energy INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS session_muscles (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        muscle TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS exercises (
        id SERIAL PRIMARY KEY,
        session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        muscle TEXT,
        sets INTEGER NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        weight DOUBLE PRECISION NOT NULL DEFAULT 0,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS measurements (
        id SERIAL PRIMARY KEY,
        day TEXT NOT NULL,
        body_weight DOUBLE PRECISION,
        chest DOUBLE PRECISION,
        waist DOUBLE PRECISION,
        arms DOUBLE PRECISION,
        thighs DOUBLE PRECISION,
        notes TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_day ON sessions(day)",
    "CREATE INDEX IF NOT EXISTS idx_muscles_session ON session_muscles(session_id)",
    "CREATE INDEX IF NOT EXISTS idx_exercises_session ON exercises(session_id)",
]


def init_db(defaults: Optional[Dict[str, str]] = None) -> None:
    """Create tables (idempotent 'migration') and seed default settings."""
    statements: Iterable[str] = PG_SCHEMA if _state["backend"] == "postgresql" else SQLITE_SCHEMA
    with _lock, connection() as conn:
        cur = conn.cursor()
        for stmt in statements:
            cur.execute(stmt)
        for key, value in (defaults or {}).items():
            if _state["backend"] == "postgresql":
                cur.execute(
                    "INSERT INTO app_settings (key, value) VALUES (%s, %s) "
                    "ON CONFLICT (key) DO NOTHING",
                    (key, value),
                )
            else:
                cur.execute(
                    "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
                    (key, value),
                )


def get_settings() -> Dict[str, str]:
    return {r["key"]: r["value"] for r in query("SELECT key, value FROM app_settings")}


def set_setting(key: str, value: str) -> None:
    if _state["backend"] == "postgresql":
        execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (key, value),
        )
    else:
        execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def healthy() -> bool:
    try:
        query_one("SELECT 1 AS ok")
        return True
    except Exception:
        return False
