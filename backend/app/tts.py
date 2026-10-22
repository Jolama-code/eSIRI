"""Text-to-speech behind one interface, with an in-memory cache.

TTS_PROVIDER selects the engine:
- "openai" (default): OpenAI gpt-4o-mini-tts with one fixed voice (OPENAI_TTS_VOICE), so NURU always
  sounds like the same person in Swahili and English.
- "chatterbox": reserved for a future self-hosted Chatterbox server. It is a documented stub: it is not
  implemented in this build (no voice cloning), and selecting it falls back to OpenAI with a warning.
"""

from __future__ import annotations

import hashlib
import logging
import os
from typing import Protocol

from . import llm

log = logging.getLogger("esiri.tts")

_cache: dict[str, bytes] = {}
_CACHE_MAX = 300

SW_INSTRUCTIONS = (
    "Speak in natural, fluent Kiswahili with a warm Tanzanian accent, as a friendly, calm government "
    "assistant. Pronounce Swahili words correctly and clearly, at a relaxed, unhurried pace."
)
EN_INSTRUCTIONS = "Speak clearly and warmly, as a friendly and professional government assistant from Tanzania."


class TTSEngine(Protocol):
    async def synthesize(self, text: str, lang: str) -> bytes: ...


class OpenAITTS:
    async def synthesize(self, text: str, lang: str) -> bytes:
        client = llm.client()
        model = os.getenv("OPENAI_TTS_MODEL", "gpt-4o-mini-tts").split("#")[0].strip() or "gpt-4o-mini-tts"
        voice = os.getenv("OPENAI_TTS_VOICE", "coral").split("#")[0].strip() or "coral"
        instructions = SW_INSTRUCTIONS if lang == "sw" else EN_INSTRUCTIONS
        try:
            resp = await client.audio.speech.create(
                model=model, voice=voice, input=text, instructions=instructions, response_format="mp3"
            )
            return resp.content
        except Exception as exc:  # retry once with the classic model
            log.warning("TTS with %s failed (%s); retrying with tts-1", model, exc)
            fallback_voice = voice if voice in {"alloy", "echo", "fable", "onyx", "nova", "shimmer"} else "nova"
            resp = await client.audio.speech.create(model="tts-1", voice=fallback_voice, input=text, response_format="mp3")
            return resp.content


class ChatterboxTTS:
    """Stub for a later self-hosted Chatterbox server (CHATTERBOX_URL). Not implemented in this build."""

    async def synthesize(self, text: str, lang: str) -> bytes:
        raise NotImplementedError("The chatterbox TTS provider is not implemented in this build.")


def tts_provider() -> str:
    return os.getenv("TTS_PROVIDER", "openai").split("#")[0].strip().lower() or "openai"


def engine() -> TTSEngine:
    if tts_provider() == "chatterbox":
        log.warning("TTS_PROVIDER=chatterbox is a stub; using OpenAI.")
    return OpenAITTS()


def _key(text: str, lang: str) -> str:
    return hashlib.sha256(f"{lang}\x00{text}".encode("utf-8")).hexdigest()


async def synthesize(text: str, lang: str) -> bytes:
    key = _key(text, lang)
    if key in _cache:
        return _cache[key]
    audio = await engine().synthesize(text, lang)
    if len(_cache) >= _CACHE_MAX:
        _cache.pop(next(iter(_cache)))
    _cache[key] = audio
    return audio
