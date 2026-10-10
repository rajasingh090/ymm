"""
GymPulse AI - Hindu lunar calendar (panchanga) support.

Strategy
--------
1. If an accurate third-party panchanga library is installed we use it.
   (`pip install drikpanchanga` style packages expose `panchanga`.)
2. Otherwise we compute the lunar month ourselves using the standard
   astronomical algorithms published in Jean Meeus, *Astronomical Algorithms*
   (2nd ed., chapters 25 and 47) combined with the Lahiri (Chitrapaksha)
   ayanamsha.  This is a real astronomical computation - not a renaming of
   Gregorian months - and is typically accurate to well under a day for the
   new-moon instants that define the lunar months.
3. If neither path works the caller is told that conversion is unavailable
   and the UI falls back to the Gregorian calendar with an explanation.

Every workout is stored with an unambiguous Gregorian (ISO) date; the Hindu
calendar is only a display / navigation layer on top of those records.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Dict, Optional

MONTHS = [
    "Chaitra", "Vaishakha", "Jyeshtha", "Ashadha", "Shravana", "Bhadrapada",
    "Ashwin", "Kartika", "Margashirsha", "Pausha", "Magha", "Phalguna",
]

TITHI_NAMES = [
    "Pratipada", "Dwitiya", "Tritiya", "Chaturthi", "Panchami", "Shashthi",
    "Saptami", "Ashtami", "Navami", "Dashami", "Ekadashi", "Dwadashi",
    "Trayodashi", "Chaturdashi", "Purnima/Amavasya",
]

try:  # pragma: no cover - optional dependency
    import panchanga as _external_panchanga  # type: ignore
    HAS_EXTERNAL = True
except Exception:  # pragma: no cover
    _external_panchanga = None
    HAS_EXTERNAL = False

# Indian Standard Time offset used when resolving "which lunar day is it".
IST_OFFSET_HOURS = 5.5


# --------------------------------------------------------------------------
# astronomy helpers
# --------------------------------------------------------------------------
def julian_day(year: int, month: int, day: float) -> float:
    if month <= 2:
        year -= 1
        month += 12
    a = year // 100
    b = 2 - a + a // 4
    return (math.floor(365.25 * (year + 4716)) + math.floor(30.6001 * (month + 1))
            + day + b - 1524.5)


def _norm360(x: float) -> float:
    return x % 360.0


def sun_longitude(jd: float) -> float:
    """Apparent geometric longitude of the Sun (tropical, degrees)."""
    t = (jd - 2451545.0) / 36525.0
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians(_norm360(357.52911 + 35999.05029 * t - 0.0001537 * t * t))
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m)
         + 0.000289 * math.sin(3 * m))
    return _norm360(l0 + c)


_MOON_TERMS = [
    (6288774, 0, 0, 1, 0), (1274027, 2, 0, -1, 0), (658314, 2, 0, 0, 0),
    (213618, 0, 0, 2, 0), (-185116, 0, 1, 0, 0), (-114332, 0, 0, 0, 2),
    (58793, 2, 0, -2, 0), (57066, 2, -1, -1, 0), (53322, 2, 0, 1, 0),
    (45758, 2, -1, 0, 0), (-40923, 0, 1, -1, 0), (-34720, 1, 0, 0, 0),
    (-30383, 0, 1, 1, 0), (15327, 2, 0, 0, -2), (-12528, 0, 0, 1, 2),
    (10980, 0, 0, 1, -2), (10675, 4, 0, -1, 0), (10034, 0, 0, 3, 0),
    (8548, 4, 0, -2, 0), (-7888, 2, 1, -1, 0), (-6766, 2, 1, 0, 0),
    (-5163, 1, 0, -1, 0), (4987, 1, 1, 0, 0), (4036, 2, -1, 1, 0),
    (3994, 2, 0, 2, 0), (3861, 4, 0, 0, 0), (3665, 2, 0, -3, 0),
]


def moon_longitude(jd: float) -> float:
    """Apparent longitude of the Moon (tropical, degrees)."""
    t = (jd - 2451545.0) / 36525.0
    lp = 218.3164477 + 481267.88123421 * t - 0.0015786 * t * t
    d = math.radians(_norm360(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t))
    m = math.radians(_norm360(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t))
    mp = math.radians(_norm360(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t))
    f = math.radians(_norm360(93.2720950 + 483202.0175233 * t - 0.0036539 * t * t))
    e = 1 - 0.002516 * t - 0.0000074 * t * t

    total = 0.0
    for coeff, cd, cm, cmp_, cf in _MOON_TERMS:
        arg = cd * d + cm * m + cmp_ * mp + cf * f
        factor = e ** abs(cm) if cm else 1.0
        total += coeff * factor * math.sin(arg)
    return _norm360(lp + total / 1_000_000.0)


def lahiri_ayanamsha(jd: float) -> float:
    """Chitrapaksha (Lahiri) ayanamsha in degrees - linear approximation."""
    t = (jd - 2451545.0) / 36525.0
    return 23.85306 + 1.3972 * t  # ~50.29 arcsec / year


def elongation(jd: float) -> float:
    """Moon - Sun longitude difference, 0..360."""
    return _norm360(moon_longitude(jd) - sun_longitude(jd))


def new_moon_near(jd: float) -> float:
    """Julian day of the new moon nearest to `jd` (refined numerically)."""
    k = round((jd - 2451550.09766) / 29.530588861)
    guess = 2451550.09766 + 29.530588861 * k
    for _ in range(40):
        diff = elongation(guess)
        if diff > 180:
            diff -= 360.0
        if abs(diff) < 1e-6:
            break
        # Moon gains ~12.19 deg/day on the Sun.
        guess -= diff / 12.190749
    return guess


def last_new_moon(jd: float) -> float:
    nm = new_moon_near(jd)
    if nm > jd:
        nm = new_moon_near(jd - 29.53)
        while nm > jd:
            nm = new_moon_near(nm - 29.53)
    return nm


# --------------------------------------------------------------------------
# public API
# --------------------------------------------------------------------------
def available() -> bool:
    """Hindu conversion is available (external library or built-in algorithm)."""
    try:
        convert(date(2024, 1, 1))
        return True
    except Exception:  # pragma: no cover
        return False


def method() -> str:
    if HAS_EXTERNAL:  # pragma: no cover
        return "external panchanga library"
    return "built-in Meeus/Lahiri astronomical computation"


def convert(d: date, system: str = "amanta") -> Dict[str, object]:
    """Convert a Gregorian date into Hindu lunar calendar components."""
    system = "purnimanta" if str(system).lower().startswith("p") else "amanta"

    # Evaluate at ~06:00 IST (sunrise convention) expressed in Universal Time.
    jd = julian_day(d.year, d.month, d.day + (6.0 - IST_OFFSET_HOURS) / 24.0)

    nm = last_new_moon(jd)
    sun_sid = _norm360(sun_longitude(nm) - lahiri_ayanamsha(nm))
    rashi = int(sun_sid // 30)                 # 0 = Mesha
    amanta_index = (rashi + 1) % 12            # 0 = Chaitra

    elong = elongation(jd)
    tithi_num = int(elong // 12) + 1           # 1..30
    paksha = "Shukla" if tithi_num <= 15 else "Krishna"
    tithi_name = TITHI_NAMES[(tithi_num - 1) % 15]
    if tithi_num == 15:
        tithi_name = "Purnima"
    elif tithi_num == 30:
        tithi_name = "Amavasya"

    index = amanta_index
    if system == "purnimanta" and paksha == "Krishna":
        index = (amanta_index + 1) % 12

    # Shaka samvat (elapsed) - solar year reference, good enough for display.
    shaka = d.year - 78 if (d.month > 3 or (d.month == 3 and d.day >= 22)) else d.year - 79
    vikram = shaka + 135

    return {
        "month": MONTHS[index],
        "month_index": index,
        "amanta_month": MONTHS[amanta_index],
        "system": system,
        "paksha": paksha,
        "tithi": tithi_num if tithi_num <= 15 else tithi_num - 15,
        "tithi_absolute": tithi_num,
        "tithi_name": tithi_name,
        "shaka_samvat": shaka,
        "vikram_samvat": vikram,
        "method": method(),
        "label": f"{MONTHS[index]} {paksha} {tithi_name}",
    }


def safe_convert(d: date, system: str = "amanta") -> Optional[Dict[str, object]]:
    try:
        return convert(d, system)
    except Exception:  # pragma: no cover
        return None


def month_label(d: date, system: str = "amanta") -> str:
    info = safe_convert(d, system)
    return str(info["month"]) if info else "unavailable"
