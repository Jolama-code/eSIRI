"""eSiri backend: agent step endpoint, TTS, audit log."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Literal, Optional

import openai
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from . import agent
from .tts import synthesize

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

AUDIT_FILE = BACKEND_DIR / "audit_log.jsonl"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("esiri")


def model_name() -> str:
    return os.getenv("OPENAI_MODEL", "gpt-4.1-mini").strip() or "gpt-4.1-mini"


def api_key() -> str:
    return os.getenv("OPENAI_API_KEY", "").strip()


def english_tts() -> str:
    value = os.getenv("ESIRI_ENGLISH_TTS", "browser").split("#")[0].strip().lower()
    return "openai" if value == "openai" else "browser"


_client: Optional[AsyncOpenAI] = None


def client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=api_key(), timeout=60.0, max_retries=1)
    return _client


app = FastAPI(title="NURU backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# session_id -> list of chat messages (see agent.py for the format)
SESSIONS: dict[str, list[dict[str, Any]]] = {}
LOCKS: dict[str, asyncio.Lock] = {}


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message, "code": code})


class ToolResult(BaseModel):
    tool_call_id: str
    result: Any


class StepRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=200)
    language: Literal["en", "sw"] = "en"
    user_message: Optional[str] = None
    input_mode: Literal["voice", "text"] = "text"
    tool_results: Optional[list[ToolResult]] = None
    snapshot: Any = None


class ResetRequest(BaseModel):
    session_id: str


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    lang: Literal["en", "sw"] = "sw"


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "has_key": bool(api_key()), "model": model_name(), "english_tts": english_tts()}


@app.post("/api/agent/reset")
async def reset(req: ResetRequest) -> dict[str, Any]:
    SESSIONS.pop(req.session_id, None)
    return {"ok": True}


@app.post("/api/agent/step")
async def step(req: StepRequest):
    if not api_key():
        return error(400, "no_key", "OPENAI_API_KEY is not set. Add it to the .env file in the project root and restart.")

    lock = LOCKS.setdefault(req.session_id, asyncio.Lock())
    async with lock:
        messages = SESSIONS.setdefault(req.session_id, [])
        snapshot_text = agent.compact_json(req.snapshot) if req.snapshot is not None else None

        if req.user_message is not None:
            agent.repair_dangling_tool_calls(messages)
            content = f"[language={req.language}] [input={req.input_mode}] User request: {req.user_message}"
            names = _room_names(req.snapshot)
            if names:
                content += (
                    "\n(Existing room names, exact: " + "; ".join(f'"{n}"' for n in names)
                    + ". Any other name, including a translation of one of these, is a new room.)"
                )
            msg: dict[str, Any] = {"role": "user", "content": content}
            if snapshot_text:
                msg["_snapshot"] = snapshot_text
            messages.append(msg)
        elif req.tool_results is not None:
            last_assistant = next((m for m in reversed(messages) if m.get("role") == "assistant"), None)
            if not last_assistant or not last_assistant.get("tool_calls"):
                return error(409, "session_expired", "The conversation was reset on the server. Please ask again.")
            expected = [tc["id"] for tc in last_assistant["tool_calls"]]
            given = {r.tool_call_id: r.result for r in req.tool_results}
            for idx, tc_id in enumerate(expected):
                result = given.get(tc_id, {"skipped": True})
                tool_msg: dict[str, Any] = {
                    "role": "tool",
                    "tool_call_id": tc_id,
                    "content": agent.compact_json(result),
                }
                if snapshot_text and idx == len(expected) - 1:
                    tool_msg["_snapshot"] = snapshot_text
                messages.append(tool_msg)
        else:
            return error(422, "bad_request", "Send either user_message or tool_results.")

        trimmed = agent.trim_history(messages)
        if trimmed is not messages:
            messages[:] = trimmed

        api_messages = [{"role": "system", "content": agent.build_system_prompt(req.language)}]
        api_messages += agent.render_messages(messages)

        try:
            completion = await client().chat.completions.create(
                model=model_name(),
                messages=api_messages,
                tools=agent.TOOLS,
                temperature=0.2,
                parallel_tool_calls=True,
            )
        except openai.NotFoundError as exc:
            log.error("Model not found: %s", exc)
            return error(
                502,
                "model_not_found",
                f"The model '{model_name()}' is not available for this API key. Change OPENAI_MODEL in the .env file (for example gpt-4.1-mini or gpt-4o-mini) and restart.",
            )
        except openai.AuthenticationError:
            return error(401, "auth", "The OpenAI API key was rejected. Check OPENAI_API_KEY in the .env file.")
        except openai.RateLimitError as exc:
            return error(429, "rate_limit", f"OpenAI rate limit or quota reached: {exc}")
        except openai.BadRequestError as exc:
            log.error("Bad request: %s", exc)
            if "model" in str(exc).lower() and ("does not exist" in str(exc).lower() or "not found" in str(exc).lower()):
                return error(502, "model_not_found", f"The model '{model_name()}' is not available. Change OPENAI_MODEL in the .env file.")
            # Most likely a corrupted history: start fresh next time.
            SESSIONS.pop(req.session_id, None)
            return error(502, "bad_request", f"The AI service rejected the request: {exc}")
        except (openai.APIConnectionError, openai.APITimeoutError) as exc:
            return error(504, "network", f"Could not reach the AI service: {exc}")
        except openai.APIError as exc:
            return error(502, "api_error", f"AI service error: {exc}")

        choice = completion.choices[0].message
        assistant_msg: dict[str, Any] = {"role": "assistant", "content": choice.content or ""}
        tool_calls_out = []
        if choice.tool_calls:
            assistant_msg["tool_calls"] = []
            for tc in choice.tool_calls:
                fn = getattr(tc, "function", None)
                if fn is None:
                    continue
                assistant_msg["tool_calls"].append(
                    {"id": tc.id, "type": "function", "function": {"name": fn.name, "arguments": fn.arguments}}
                )
                try:
                    args = json.loads(fn.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                tool_calls_out.append({"id": tc.id, "name": fn.name, "arguments": args})
            if not assistant_msg["tool_calls"]:
                del assistant_msg["tool_calls"]
        messages.append(assistant_msg)

        log.info(
            "session=%s tools=%s text=%r",
            req.session_id[:8],
            [f'{t["name"]}({t["arguments"].get("element_id") or t["arguments"].get("page") or ""})' for t in tool_calls_out],
            (choice.content or "")[:80],
        )
        return {"tool_calls": tool_calls_out, "text": choice.content or ""}


def _room_names(snapshot: Any) -> list[str]:
    try:
        return [str(r["name"]) for r in snapshot["state"]["rooms"]]
    except (KeyError, TypeError):
        return []


@app.post("/api/tts")
async def tts(req: TTSRequest):
    if not api_key():
        return error(400, "no_key", "OPENAI_API_KEY is not set.")
    try:
        audio = await synthesize(client(), req.text, req.lang)
    except Exception as exc:  # noqa: BLE001
        log.error("TTS failed: %s", exc)
        return error(502, "tts_failed", f"Text-to-speech failed: {exc}")
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/audit")
async def audit(record: dict[str, Any]) -> dict[str, Any]:
    line = json.dumps(record, ensure_ascii=False)
    await asyncio.to_thread(_append_audit, line)
    return {"ok": True}


def _append_audit(line: str) -> None:
    with AUDIT_FILE.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
