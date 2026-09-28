"""Text-to-speech through OpenAI, with an in-memory cache."""

from __future__ import annotations

import hashlib
import logging
import os

from openai import AsyncOpenAI

log = logging.getLogger("esiri.tts")

_cache: dict[str, bytes] = {}
_CACHE_MAX = 200

SW_INSTRUCTIONS = (
    "Speak in natural, fluent Kiswahili with a warm Tanzanian accent, as a friendly "
    "government assistant. Pronounce Swahili words correctly and clearly, at a calm pace."
)
EN_INSTRUCTIONS = "Speak clearly and warmly, as a friendly and professional government assistant."


def _key(text: str, lang: str) -> str:
    return hashlib.sha256(f"{lang}\x00{text}".encode("utf-8")).hexdigest()


async def synthesize(client: AsyncOpenAI, text: str, lang: str) -> bytes:
    key = _key(text, lang)
    if key in _cache:
        return _cache[key]

    model = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts")
    voice = os.getenv("OPENAI_TTS_VOICE", "coral")
    instructions = SW_INSTRUCTIONS if lang == "sw" else EN_INSTRUCTIONS

    try:
        resp = await client.audio.speech.create(
            model=model, voice=voice, input=text, instructions=instructions, response_format="mp3"
        )
        audio = resp.content
    except Exception as exc:  # retry once with the classic model
        log.warning("TTS with %s failed (%s); retrying with tts-1", model, exc)
        fallback_voice = voice if voice in {"alloy", "echo", "fable", "onyx", "nova", "shimmer"} else "nova"
        resp = await client.audio.speech.create(
            model="tts-1", voice=fallback_voice, input=text, response_format="mp3"
        )
        audio = resp.content

    if len(_cache) >= _CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = audio
    return audio
