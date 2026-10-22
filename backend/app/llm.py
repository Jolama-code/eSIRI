"""OpenAI client and the spoken date/time phrases NURU uses in both languages."""

from __future__ import annotations

import os
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
