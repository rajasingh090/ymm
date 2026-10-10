"""
GymPulse AI - optional self-ping monitor.

Honest note: self-pinging does NOT guarantee that a free Render service stays
awake.  Render may sleep free instances according to its current policies and
traffic that originates from the same service may not prevent that.  Treat
this purely as a lightweight uptime/health monitor, and use an external
monitor (UptimeRobot, Better Stack, a cron job, ...) if you need real
keep-alive behaviour.

Safety features
---------------
* one worker process only - an exclusive file lock is taken so that multiple
  Gunicorn workers cannot each start a thread;
* a single daemon thread per process, guarded by a module level flag;
* finite HTTP timeout, no overlapping requests (strictly sequential loop);
* connection/HTTP errors are swallowed, the loop keeps running;
* status is logged only when it CHANGES (no log spam);
* stops cleanly through a threading.Event.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
from typing import Optional
from urllib.parse import urlparse

try:
    import requests
except Exception:  # pragma: no cover
    requests = None  # type: ignore

log = logging.getLogger("gympulse.selfping")

_thread: Optional[threading.Thread] = None
_stop = threading.Event()
_lock_handle = None
_started = False

PLACEHOLDER_TOKENS = ("YOUR-APP-NAME", "your-app-name", "example.com", "localhost", "127.0.0.1")


def validate_url(url: str) -> tuple[bool, str]:
    url = (url or "").strip()
    if not url:
        return False, "SELF_PING_URL is empty."
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return False, "SELF_PING_URL is not a valid absolute http(s) URL."
    for token in PLACEHOLDER_TOKENS:
        if token in url:
            return False, f"SELF_PING_URL still contains the placeholder/non-public value '{token}'."
    return True, ""


def health_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if url.endswith("/health"):
        return url
    return url + "/health"


def _acquire_single_process_lock() -> bool:
    """Only one process (Gunicorn worker) may run the pinger."""
    global _lock_handle
    path = os.path.join(tempfile.gettempdir(), "gympulse_selfping.lock")
    try:
        import fcntl

        handle = open(path, "w")
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        handle.write(str(os.getpid()))
        handle.flush()
        _lock_handle = handle
        return True
    except ImportError:  # pragma: no cover - non-POSIX
        return True
    except Exception:
        return False


def _loop(url: str, interval: int, timeout: int) -> None:
    target = health_url(url)
    last_state: Optional[str] = None
    log.info("Self-ping worker started for %s every %ss", target, interval)
    while not _stop.is_set():
        state = "down"
        detail = ""
        try:
            resp = requests.get(target, timeout=timeout)  # type: ignore[union-attr]
            if 200 <= resp.status_code < 300:
                state = "up"
            else:
                detail = f"HTTP {resp.status_code}"
        except Exception as exc:
            detail = exc.__class__.__name__
        if state != last_state:
            if state == "up":
                log.info("Self-ping: service reachable (%s)", target)
            else:
                log.warning("Self-ping: service unreachable (%s) - %s", target, detail)
            last_state = state
        _stop.wait(interval)
    log.info("Self-ping worker stopped")


def start(url: str, *, enabled: bool, interval: int = 600, timeout: int = 15) -> str:
    """Start the worker if allowed.  Returns a human readable status string."""
    global _thread, _started

    if not enabled:
        return "disabled in configuration"
    if requests is None:  # pragma: no cover
        return "disabled: the 'requests' library is not installed"
    ok, reason = validate_url(url)
    if not ok:
        log.warning("Self-ping disabled: %s", reason)
        return f"disabled: {reason}"
    if _started and _thread and _thread.is_alive():
        return "already running"
    if not _acquire_single_process_lock():
        return "disabled: another process already owns the self-ping worker"

    interval = max(int(interval), 60)
    timeout = max(min(int(timeout), 60), 1)
    _stop.clear()
    _thread = threading.Thread(target=_loop, args=(url, interval, timeout),
                               name="gympulse-selfping", daemon=True)
    _thread.start()
    _started = True
    return f"running every {interval}s against {health_url(url)}"


def stop() -> None:
    global _started
    _stop.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=2)
    _started = False


def is_running() -> bool:
    return bool(_thread and _thread.is_alive())
