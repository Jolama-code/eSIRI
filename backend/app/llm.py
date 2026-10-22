"""OpenAI client and the spoken date/time phrases NURU uses in both languages."""

from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Optional

from openai import AsyncOpenAI

from .core import local_today, to_local


def model_name() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4.1-mini").split("#")[0].strip() or "gpt-4.1-mini"


def api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "").strip()


_client: Optional[AsyncOpenAI] = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=api_key(), timeout=60.0, max_retries=1)
    return _client


SW_DAYS = ["Jumatatu", "Jumanne", "Jumatano", "Alhamisi", "Ijumaa", "Jumamosi", "Jumapili"]
EN_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
SW_NUM = ["", "moja", "mbili", "tatu", "nne", "tano", "sita", "saba", "nane", "tisa", "kumi", "kumi na moja", "kumi na mbili"]


def sw_clock(h: int, m: int) -> str:
    """24 h → Swahili time: 14:00 → 'saa nane mchana', 10:30 → 'saa nne na nusu asubuhi'."""
    if m >= 45 and m != 0:
        h, prefix_less = (h + 1) % 24, True
    else:
        prefix_less = False
    sw_h = (h + 6) % 12 or 12
    if 4 <= h <= 6:
        period = "alfajiri"
    elif 7 <= h <= 11:
        period = "asubuhi"
    elif 12 <= h <= 15:
        period = "mchana"
    elif 16 <= h <= 18:
        period = "jioni"
    else:
        period = "usiku"
    word = SW_NUM[sw_h]
    if prefix_less:
        mins = "kasoro robo" if m == 45 else f"kasoro dakika {60 - m}"
        return f"saa {word} {mins} {period}"
    if m == 0:
        return f"saa {word} {period}"
    if m == 30:
        return f"saa {word} na nusu {period}"
    if m == 15:
        return f"saa {word} na robo {period}"
    return f"saa {word} na dakika {m} {period}"


def en_clock(h: int, m: int) -> str:
    suffix = "a.m." if h < 12 else "p.m."
    hh = h % 12 or 12
    return f"{hh}:{m:02d} {suffix}"


def sw_when(dt_utc: datetime) -> str:
    loc = to_local(dt_utc)
    today = local_today()
    d = loc.date()
    if d == today:
        day = "leo"
    elif d == today + timedelta(days=1):
        day = "kesho"
    else:
        day = SW_DAYS[d.weekday()]
    return f"{day} {sw_clock(loc.hour, loc.minute)}"


def en_when(dt_utc: datetime) -> str:
    loc = to_local(dt_utc)
    today = local_today()
    d = loc.date()
    if d == today:
        day = "today"
    elif d == today + timedelta(days=1):
        day = "tomorrow"
    else:
        day = EN_DAYS[d.weekday()]
    return f"{day} at {en_clock(loc.hour, loc.minute)}"


# ---------------------------------------------------------------------------
# Spoken times → HH:MM, in code (the model only copies the words the user said).
#
# Swahili time counts hours from 06:00 / 18:00: "saa N" = (N + 6) mod 12, and the period word
# (asubuhi, mchana, jioni, usiku, alfajiri) chooses the half of the day.

SW_WORDS = {
    "kumi na mbili": 12, "kumi na moja": 11, "kumi": 10, "moja": 1, "mbili": 2, "tatu": 3, "nne": 4,
    "tano": 5, "sita": 6, "saba": 7, "nane": 8, "tisa": 9,
}
_SW_NUM = "kumi na mbili|kumi na moja|kumi|moja|mbili|tatu|nne|tano|sita|saba|nane|tisa|\\d{1,2}"
_SW_RE = re.compile(
    rf"\bsaa\s+({_SW_NUM})\b"
    r"(?:\s+(na nusu|na robo|kasoro robo|na dakika\s+(\d{1,2})|kasoro dakika\s+(\d{1,2})))?",
    re.I,
)
_PERIOD_RE = re.compile(r"\b(asubuhi|mchana|jioni|usiku|alfajiri)\b", re.I)
_EN_AMPM = re.compile(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])", re.I)
_H24 = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b")


def _sw_hour(n: int, period: Optional[str]) -> int:
    base = (n + 6) % 12  # 0..11
    p = (period or "").lower()
    if p == "asubuhi":
        return 12 if base == 0 else base
    if p == "mchana":
        return base + 12 if base <= 6 else base
    if p == "jioni":
        return min(23, base + 12)
    if p == "usiku":
        return base + 12 if base >= 7 else base
    if p == "alfajiri":
        return base
    # no period word: office hours are the likely meaning (saa mbili–tano = 08–11, saa sita–kumi na mbili = 12–18)
    if base == 0:
        return 12
    return base if base >= 7 else base + 12


def parse_spoken_time(phrase: str) -> Optional[str]:
    """'saa kumi jioni' → '16:00', 'saa nne na nusu asubuhi' → '10:30', '4 pm' → '16:00', '16:00' → '16:00'."""
    if not phrase:
        return None
    text = " ".join(phrase.lower().replace(",", " ").split())
    m = _SW_RE.search(text)
    if m:
        word = m.group(1)
        n = int(word) if word.isdigit() else SW_WORDS[word]
        if not 1 <= n <= 12:
            return None
        pm = _PERIOD_RE.search(text)
        h = _sw_hour(n, pm.group(1) if pm else None)
        minutes = 0
        extra = (m.group(2) or "").lower()
        if extra == "na nusu":
            minutes = 30
        elif extra == "na robo":
            minutes = 15
        elif extra == "kasoro robo":
            minutes = -15
        elif extra.startswith("na dakika"):
            minutes = int(m.group(3))
        elif extra.startswith("kasoro dakika"):
            minutes = -int(m.group(4))
        total = (h * 60 + minutes) % (24 * 60)
        return f"{total // 60:02d}:{total % 60:02d}"
    m = _EN_AMPM.search(text)
    if m:
        h, mi = int(m.group(1)), int(m.group(2) or 0)
        if not (1 <= h <= 12 and mi < 60):
            return None
        pm = m.group(3).startswith("p")
        h = (h % 12) + (12 if pm else 0)
        return f"{h:02d}:{mi:02d}"
    m = _H24.search(text)
    if m:
        return f"{int(m.group(1)):02d}:{m.group(2)}"
    return None


_SW_FULL_RE = re.compile(
    rf"\bsaa\s+(?:{_SW_NUM})\b"
    r"(?:\s+(?:na nusu|na robo|kasoro robo|na dakika\s+\d{1,2}|kasoro dakika\s+\d{1,2}))?"
    r"(?:\s+(?:za\s+)?(?:asubuhi|mchana|jioni|usiku|alfajiri))?",
    re.I,
)


def time_notes(text: str) -> list[tuple[str, str]]:
    """Every Swahili clock phrase in a request with its 24-hour value (for the agent; computed in code)."""
    out = []
    for m in _SW_FULL_RE.finditer(text or ""):
        hhmm = parse_spoken_time(m.group(0))
        if hhmm:
            out.append((m.group(0), hhmm))
    return out
