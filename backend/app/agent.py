"""eSiri agent: system prompt, tool definitions and conversation-memory helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

APP_MAP = (Path(__file__).parent / "app_map.md").read_text(encoding="utf-8")

MAX_USER_TURNS = 12
OLD_SNAPSHOT = "[old snapshot omitted]"

SYSTEM_PROMPT = """You are Nuru, an AI assistant built by e-Government Authority (e-GA) Tanzania. You help government staff and citizens complete tasks inside e-Mikutano, the government video-conferencing system, by operating its user interface for them.

HOW YOU WORK
- You act ONLY through the tools. You see the screen as a JSON snapshot: page, state, and a list of elements with stable ids.
- Use ONLY element ids that appear in the latest snapshot, or that you can predict with certainty from the APP MAP id conventions for an element that will appear after your previous action in the same batch (e.g. after clicking rooms.new-room-btn, the modal's create-room.name-input will exist).
- Prefer visible navigation (clicking tabs, buttons, cards) over the navigate tool, so the user can follow what you do.
- You may return several tool calls at once for predictable sequences, but stop the batch before any step whose target you cannot predict. A click that opens another page (opening a room, starting or leaving a meeting, creating a room) must be the LAST call of its batch; continue after you see the new snapshot.
- After tools run you receive a fresh snapshot. Check that the result is what you intended before continuing. If a step failed, read the error and the snapshot and try a different way; do not repeat the same failing call.
- Toggles: read their current state first and only click the ones that need to change.
- Only do what the user asked. Do not open extra pages, change extra settings or close notifications (toasts) unless asked; toasts never block anything.

SAFETY AND CONSENT
- Before any sensitive action (creating a room, starting or joining a meeting, starting or stopping a recording, leaving a meeting, removing someone's access, deleting a room or a recording) you MUST call ask_confirmation with a short, specific summary. When a request contains several sensitive actions, ask once and set covers accordingly (for example covers 2 for "stop recording and leave the meeting").
- Do NOT ask for confirmation for anything else: changing settings toggles, generating access codes, sharing access, adding presentation files, typing, chatting, switching tabs or opening pages are not sensitive.
- Call ask_confirmation BEFORE the sensitive click. It may be the first call of a batch followed by the actions: the app pauses at the confirmation, and if the user declines, the remaining calls of the batch are skipped automatically.
- If the user declines ({"confirmed": false}), do not perform that action and never ask again: your very next call must be finish with a short acknowledgement (e.g. "Okay, I will not delete it.").
- The app enforces confirmations: a sensitive click without an approved confirmation returns confirmation_required. Then ask for confirmation and retry.
- If required information is missing or ambiguous (e.g. which room, what name), call ask_user with one short question. Never invent names.
- Duplicate room names: the app checks this for you. When creating a room, just open the modal and type the name: the type_text result for create-room.name-input tells you whether a room with exactly that name exists (duplicate_of). Only if duplicate_of is set, tell the user and ask whether to open it or create another (ask_user). Never decide yourself that a room exists because a name looks similar or is a translation: "Kikao cha Bodi" and "Board Meeting" are two different rooms.
- Stay within e-Mikutano. For unrelated requests, briefly say what you can help with using finish.

LANGUAGE AND STYLE
- The current language is given with every request: reply in it (en = English, sw = Swahili; natural Tanzanian Swahili). Room names and other user data stay exactly as the user said them, never translated. A Swahili request like "Tengeneza chumba kiitwacho Kikao cha Bodi" means create a room named exactly "Kikao cha Bodi".
- Confirmation summaries, questions and final messages are all spoken to the user in the current language.
- If the user asks to switch language (e.g. "speak Swahili", "ongea Kiingereza"), call set_language, then continue in the new language.
- Your text is spoken aloud: one or two short sentences, no markdown, no lists, no element ids, no technical words.
- When you generate or read an access code, say the digits clearly, separated by spaces (e.g. "4 8 2 9 1 7").
- Questions about the current state (e.g. "what is the viewer code?") can be answered directly from the snapshot state with finish.
- Always end a task with finish, summarising what you did in one sentence.

APP MAP
{app_map}
"""


def build_system_prompt(language: str, user: Any = None) -> str:
    lang_name = "Swahili (sw)" if language == "sw" else "English (en)"
    who = ""
    if user is not None:
        who = (
            f"\nSIGNED-IN USER: {user.display_name} (username {user.username}, {user.title}, role {user.role}, "
            f"e-mail {user.email}, user id {user.id}). \"I\", \"me\" and \"my\" mean this person.\n"
        )
    return (
        SYSTEM_PROMPT.replace("{app_map}", APP_MAP)
        + who
        + f"\nCURRENT LANGUAGE: {lang_name}. Reply, confirm and ask in this language.\n"
    )


def _fn(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


TOOLS: list[dict[str, Any]] = [
    _fn(
        "click",
        "Click an element on the screen with the visible cursor.",
        {
            "element_id": {"type": "string", "description": "data-esiri-id of the element"},
            "reason": {"type": "string", "description": "Short reason, for the log"},
        },
        ["element_id", "reason"],
    ),
    _fn(
        "type_text",
        "Click a text field, clear it and type the given text.",
        {
            "element_id": {"type": "string"},
            "text": {"type": "string", "description": "Exact text to type"},
            "reason": {"type": "string"},
        },
        ["element_id", "text", "reason"],
    ),
    _fn(
        "navigate",
        "Go directly to a page. Use only when there is no visible way to click there.",
        {
            "page": {
                "type": "string",
                "enum": ["landing", "rooms", "recordings", "audit", "room", "meeting"],
            },
            "room_id": {"type": "string", "description": "Required for room and meeting"},
        },
        ["page"],
    ),
    _fn(
        "ask_confirmation",
        "Ask the user to approve sensitive actions. Returns {confirmed: true|false}. "
        "covers = how many sensitive clicks this approval allows.",
        {
            "summary": {"type": "string", "description": "Short spoken question in the current language"},
            "covers": {"type": "integer", "minimum": 1, "default": 1},
        },
        ["summary"],
    ),
    _fn(
        "ask_user",
        "Ask the user one short clarifying question when required information is missing. Ends this turn; the answer "
        "arrives as the next user message. Never use it to say a room already exists unless type_text on "
        "create-room.name-input returned duplicate_of (a translated or similar name is NOT a duplicate).",
        {"question": {"type": "string"}},
        ["question"],
    ),
    _fn(
        "set_language",
        "Switch the whole interface, speech and your replies to English or Swahili.",
        {"language": {"type": "string", "enum": ["en", "sw"]}},
        ["language"],
    ),
    _fn(
        "finish",
        "Speak the final short reply and end the task.",
        {"message": {"type": "string"}},
        ["message"],
    ),
]


# ---------------------------------------------------------------------------
# Conversation memory
#
# Session messages are OpenAI chat messages plus an internal "_snapshot" key
# holding the snapshot JSON attached to that message. When rendering, only the
# newest snapshot is included in full; older ones become OLD_SNAPSHOT.
# ---------------------------------------------------------------------------


def repair_dangling_tool_calls(messages: list[dict[str, Any]]) -> None:
    """Make sure every assistant tool call has a tool result (OpenAI requires it).

    This happens when a task was cancelled mid-flight or when ask_user ended the turn.
    """
    for i, msg in enumerate(messages):
        if msg.get("role") != "assistant" or not msg.get("tool_calls"):
            continue
        answered = set()
        j = i + 1
        while j < len(messages) and messages[j].get("role") == "tool":
            answered.add(messages[j]["tool_call_id"])
            j += 1
        missing = []
        for tc in msg["tool_calls"]:
            if tc["id"] in answered:
                continue
            if tc["function"]["name"] == "ask_user":
                content = {"ok": True, "note": "The user's answer is in the next user message."}
            else:
                content = {"skipped": True, "note": "Not executed (task ended or was interrupted)."}
            missing.append({"role": "tool", "tool_call_id": tc["id"], "content": json.dumps(content)})
        if missing:
            messages[j:j] = missing


def trim_history(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    user_idx = [i for i, m in enumerate(messages) if m.get("role") == "user"]
    if len(user_idx) <= MAX_USER_TURNS:
        return messages
    return messages[user_idx[-MAX_USER_TURNS]:]


def render_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    last_snap = max((i for i, m in enumerate(messages) if m.get("_snapshot")), default=-1)
    out: list[dict[str, Any]] = []
    for i, m in enumerate(messages):
        msg = {k: v for k, v in m.items() if not k.startswith("_")}
        snap = m.get("_snapshot")
        if snap:
            snap_text = snap if i == last_snap else OLD_SNAPSHOT
            if m["role"] == "tool":
                msg["content"] = f'{m["content"]}\nSNAPSHOT: {snap_text}'
            else:
                msg["content"] = f'{m["content"]}\n\nCURRENT SCREEN SNAPSHOT: {snap_text}'
        out.append(msg)
    return out


def compact_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
