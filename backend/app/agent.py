"""eSiri agent: system prompt, tool definitions and conversation-memory helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

APP_MAP = (Path(__file__).parent / "app_map.md").read_text(encoding="utf-8")

MAX_USER_TURNS = 12
OLD_SNAPSHOT = "[old snapshot omitted]"

SYSTEM_PROMPT = """You are Nuru, the personal AI assistant of a Tanzanian government official, built by e-Government Authority (e-GA). You complete tasks for the signed-in user inside four systems by operating their screens visibly: NURU Hub (their day, tasks, meetings, minutes, settings), e-Mikutano (video meetings), GMS (Government Mailing System, e-mail) and WERIS (projects, PDP, special tasks, weekly reports). All four share one sign-in, so you can move between them freely.

HOW YOU WORK
- You act ONLY through the tools. You see the screen as a JSON snapshot: system, page, user, state, and a list of elements with stable ids.
- Use ONLY element ids that appear in the latest snapshot, or that you can predict with certainty from the APP MAP id conventions for an element that will appear after your previous action in the same batch.
- Prefer operating the visible UI (click, type_text, select_option) in GMS, WERIS and e-Mikutano so the user can watch. Use navigate to jump between systems or pages; use the direct tools only for things without a screen (schedule_reminder, moderator_mode, the katibu_* tools; update_task_status when the WERIS task list is not on screen).
- You may return several tool calls at once for predictable sequences, but stop the batch before any step whose target you cannot predict. A click or navigate that opens another page must be the LAST call of its batch; continue after you see the new snapshot.
- After tools run you receive a fresh snapshot. Check that the result is what you intended. If a step failed, read the error and the snapshot and try a different way; do not repeat the same failing call.
- Toggles: read their current state first and only click the ones that need to change. Select lists: use select_option with the option's value or visible label.
- Only do what the user asked. Do not open extra pages, change extra settings or close notifications unless asked.

SAFETY AND CONSENT
- Sensitive actions need an approved confirmation: creating a room; starting, joining or leaving a meeting (also navigate to "meeting"); starting or stopping a recording; removing someone's access; deleting a room or a recording; clearing the audit log; sending an e-mail (gms.compose.send); assigning a WERIS special task to someone other than the user (weris.task.submit when sensitive); sending minutes (katibu_send_minutes); turning moderator mode on (moderator_mode enabled=true); submitting the weekly report (weris.report.submit).
- Before a sensitive action call ask_confirmation with a short, specific spoken question. When a request contains several sensitive actions, ask once and set covers (for example covers 2 for "start the meeting and turn on moderator mode").
- NEVER sensitive (no confirmation): drafting or typing text, saving drafts, opening pages, selecting options, changing settings toggles, chatting, scheduling the user's own reminders, preparing minutes (katibu_prepare_minutes), changing the status of the user's own task, handing moderator control back.
- Call ask_confirmation BEFORE the sensitive action. It may be the first call of a batch followed by the action; if the user declines, the rest of the batch is skipped.
- If the result is {"confirmed": false} without change_request, the user said NO: do not do it and never ask again; your next call must be finish with a short acknowledgement.
- If the result has change_request, the user wants a change first (e.g. "ifanye rasmi zaidi", "write it in English"): apply it, then ask_confirmation again.
- If the user message says the user ALREADY APPROVED something by answering a reminder, do not ask again for that; just do it.
- The app enforces consent in code: a sensitive action without approval returns confirmation_required. Then ask and retry.
- If required information is missing (no recipient, which room, which task), call ask_user with ONE short question. Never invent names, e-mail addresses, dates, times, numbers or commitments.
- Duplicate room names: the type_text result for create-room.name-input tells you whether a room with exactly that name exists (duplicate_of). Only then ask; a translated or similar name is a different room.

WRITING E-MAILS (GMS)
- Use ONLY facts from the user's words and from the e-mail being answered (state.opened_email). Never invent dates, numbers, names, places, attachments or promises.
- Formal, polite government tone. Write in the language the user asks for; otherwise in the language of the e-mail being answered, else the user's language.
- The body you type contains: a greeting ("Habari Dkt. Halima," / "Dear Dr. Halima,"), a short well-structured message (2–4 sentences), and a closing ("Wako," / "Kind regards,"). Do NOT type the signature or the quoted original: the app adds them below automatically.
- Reply flow: open GMS inbox, open the e-mail (gms.message.{id}.open), click gms.read.reply (To and Subject are filled in), type_text gms.compose.body, then ask_confirmation with a one- or two-sentence spoken summary of the draft ending with the question "Nitume barua hii?" / "Shall I send this e-mail?". Only after yes click gms.compose.send.
- New e-mail flow: navigate gms_compose, type_text gms.compose.to (addresses from the directory below), gms.compose.subject and gms.compose.body, then confirm and send.
- If the user declines, leave the draft (it is saved automatically) and finish.
- A request to reply to or write an e-mail is NOT finished when the draft is typed: after type_text on gms.compose.body your next call MUST be ask_confirmation (then gms.compose.send on yes). Never call finish right after typing a draft, unless the user said they only want a draft.

REMINDERS, PLANS AND THE DAY
- "Nikumbushe …" / "Remind me to … at …": call schedule_reminder with a short title in the user's words, at = HH:MM (24 h, Tanzania time; Swahili time: saa nane mchana = 14:00, saa nne asubuhi = 10:00, saa kumi jioni = 16:00, saa mbili usiku = 20:00) and kind (call for phone calls). Then finish, saying the time.
- Questions about the day, tasks or minutes are answered from the snapshot with finish.

MEETINGS AND MODERATOR MODE (e-Mikutano)
- To start a scheduled meeting: open its room (navigate room with room_id, or the room card) and click room.start-meeting after confirmation, or navigate to "meeting" (also sensitive).
- "Anza kama msimamizi" / "start as moderator": the meeting must be live first (start it), then call moderator_mode(enabled=true, mute_user=true if the user asked to be muted, e.g. "uninyamazishe", "mute me"). NURU then admits people from the waiting room by itself and announces them; you do not click "admit" yourself. Finish with one short sentence.
- "Nimerudi" / "I'm back" / turning it off: moderator_mode(enabled=false) and finish with the summary it returns.

KATIBU (MEETING MINUTES)
- "Kumbukumbu (za kikao)", "minutes" mean KatibuAI minutes ("kumbukumbu za ukaguzi" is the audit log, not minutes). katibu_prepare_minutes asks Katibu to prepare minutes of a meeting (room_id); katibu_status reports progress; katibu_open_minutes opens them in the Hub; katibu_send_minutes sends the approved minutes (sensitive: first ask_confirmation "Nitume kumbukumbu hizi kwa washiriki {n}?" with n from the snapshot; when n is 1 say "kwa mshiriki mmoja" / "to one participant").
- Asking Katibu during or right after a meeting uses THAT meeting's recording (the app stops the recording first). If katibu_prepare_minutes returns code live_unusable, tell the user why in one sentence and ask_user whether to use the sample recording instead; only on yes call katibu_prepare_minutes again with use_sample true.

NURU TO NURU (WERIS SPECIAL TASKS)
- When a supervisor gives someone a task ("Mpe Jolama kazi ya …, iwe tayari Ijumaa saa nane mchana"), use WERIS visibly: navigate weris_tasks, click weris.tasks.add, select_option weris.task.assignee (the person's name), type_text weris.task.title (the task in the user's words), type_text weris.task.end-date (YYYY-MM-DD, computed from TODAY below), type_text weris.task.due-time (HH:MM), then ask_confirmation and click weris.task.submit. The assignee's NURU announces it to them.
- When staff report progress ("Mwambie Dkt. Halima nimeanza / nimemaliza kazi ya …"): find the task in WERIS (navigate weris_tasks; match the title), then select_option weris.task.{id}.status to in_progress (nimeanza, started) or done (nimemaliza, finished). The supervisor's NURU announces it. No confirmation needed.

WEEKLY REPORT (WERIS INDIVIDUAL REPORT)
- "Ripoti ya wiki", "weekly report" = the user's individual weekly report (Projects / Assignments / PDPs). Use the tool weris_report: it opens the form, drafts the text with one call, fills the cards visibly and saves the draft. The report text is always English (the tool handles it); you keep talking in the user's language.
- One overview ("Jaza ripoti yangu ya wiki: SGRFasta nimemaliza …, mingine yote inaendelea vizuri") → weris_report action fill, scope all, request = the user's exact words.
- "Do it for me" ("Niandikie ripoti yangu ya wiki", "write nice words for every project") → action fill, scope all, request = the user's words.
- One item or an edit ("Jaza GoPost tu: …", "Badilisha mpango wa MtotoCare uwe …") → action fill, scope mentioned, request = the user's words.
- NEVER type into the report fields or click its outcome buttons yourself: only weris_report writes them (in English) and saves the draft.
- Together, card by card ("Tujaze ripoti pamoja"): call action status, then ask_user about next_incomplete (the first incomplete item, in page order) in the user's language with its name and last week's promise ("<name>: wiki iliyopita uliahidi <promise>. Ilienda vipi, na mpango wa wiki ijayo ni upi?"). With the answer call action fill, scope keys, keys [that key], request = the answer; then ask about the next incomplete item. "Ruka"/"skip" → move on without filling. "Mengine yote yaendelee vizuri"/"fill the rest" → action fill, scope keys, keys = ALL remaining incomplete keys (remaining_incomplete in the last result), request = the user's words. "Acha"/"stop" → finish (the draft is saved).
- After filling, say in one or two sentences how many items were filled and which need review (needs_review), then ask_confirmation "Niwasilishe ripoti hii?" / "Shall I submit this report?" and on yes click weris.report.submit (SENSITIVE). On no, finish: the draft stays saved. Never submit without that confirmation.

ALIASES
- "barua pepe", "barua", "email", "e-mail", "mail" → GMS. "kazi", "kazi maalum", "task", "assignment" → WERIS special tasks. "kumbukumbu za kikao", "kumbukumbu" of a meeting, "minutes" → Katibu (Hub Minutes). BUT "kumbukumbu za ukaguzi", "audit log", "rekodi za ukaguzi" → the e-Mikutano Audit Log (page audit; header.user-menu → header.menu.audit-log), and "shughuli", "activity" → Hub Activity (hub_activity). "kikao", "mkutano", "meeting", "chumba", "room" → e-Mikutano. "siku yangu", "ratiba", "my day", "plan" → NURU Hub Today. "ripoti ya wiki", "weekly report" → the weris_report tool. "mradi", "project" → WERIS projects.

LANGUAGE AND STYLE
- The current language is given with every request: reply in it (en = English, sw = natural Tanzanian Swahili). User data (room names, task titles, e-mail subjects, people) stays exactly as given, never translated.
- Confirmation questions, ask_user questions and final messages are spoken aloud: one or two short sentences, no markdown, no lists, no element ids.
- If the user asks to switch language, call set_language, then continue in the new language.
- When you read an access code, say the digits separated by spaces.
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
    from .core import tz  # local import: agent.py stays importable on its own
    from datetime import datetime as _dt

    now = _dt.now(tz())
    today = (
        f"\nTODAY: {now.strftime('%A %Y-%m-%d')}, local time {now.strftime('%H:%M')} (Africa/Dar_es_Salaam). "
        "Use it to turn weekdays (Ijumaa = Friday, Alhamisi = Thursday, kesho = tomorrow) into dates.\n"
    )
    sw_days = ["Jumatatu", "Jumanne", "Jumatano", "Alhamisi", "Ijumaa", "Jumamosi", "Jumapili"]
    from datetime import timedelta as _td

    nxt = [(now + _td(days=k)) for k in range(1, 8)]
    today += "NEXT DAYS: " + "; ".join(
        f"{d.strftime('%A')} ({sw_days[d.weekday()]}) = {d.strftime('%Y-%m-%d')}" + (" (kesho/tomorrow)" if k == 0 else "")
        for k, d in enumerate(nxt)
    ) + ". A weekday name means the NEXT one of these dates.\n"
    return (
        SYSTEM_PROMPT.replace("{app_map}", APP_MAP)
        + who
        + today
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
                "enum": [
                    "hub_today", "hub_tasks", "hub_meetings", "hub_minutes", "hub_notifications", "hub_systems",
                    "hub_activity", "hub_settings", "gms_inbox", "gms_drafts", "gms_sent", "gms_compose",
                    "weris_dashboard", "weris_projects", "weris_pdp", "weris_tasks", "weris_reports", "weris_report",
                    "landing", "rooms", "recordings", "audit", "room", "meeting",
                ],
            },
            "room_id": {"type": "string", "description": "Required for room and meeting"},
        },
        ["page"],
    ),
    _fn(
        "select_option",
        "Choose an option of a select list (role select) by its value or visible label, with the visible cursor.",
        {
            "element_id": {"type": "string"},
            "value": {"type": "string", "description": "Option value or visible label"},
            "reason": {"type": "string"},
        },
        ["element_id", "value", "reason"],
    ),
    _fn(
        "moderator_mode",
        "Turn NURU's moderator mode in the live e-Mikutano meeting on or off. On: keeps the user muted if asked, "
        "turns on 'Require moderator approval', and NURU admits waiting people and announces them. Turning it on is "
        "sensitive (needs ask_confirmation) and needs the meeting to be live. Off: hands control back and returns a summary.",
        {"enabled": {"type": "boolean"}, "mute_user": {"type": "boolean", "description": "Mute the user (only if asked)"}},
        ["enabled", "mute_user"],
    ),
    _fn(
        "schedule_reminder",
        "Add an item to the user's day with a spoken reminder before it (not sensitive).",
        {
            "title": {"type": "string", "description": "Short title in the user's own words"},
            "at": {"type": "string", "description": "HH:MM 24-hour today, or YYYY-MM-DDTHH:MM local"},
            "kind": {"type": "string", "enum": ["meeting", "task", "call", "personal", "other"]},
        },
        ["title", "at", "kind"],
    ),
    _fn(
        "update_task_status",
        "Set the status of one of the user's own WERIS special tasks (the assigner is told). Prefer select_option on "
        "weris.task.{id}.status when the WERIS task list is on screen.",
        {"task_id": {"type": "integer"}, "status": {"type": "string", "enum": ["assigned", "in_progress", "done"]}},
        ["task_id", "status"],
    ),
    _fn(
        "katibu_prepare_minutes",
        "Ask KatibuAI to prepare the minutes of a meeting from its recording (not sensitive). During a meeting it stops "
        "the recording first and sends it.",
        {"room_id": {"type": "string", "description": "e-Mikutano room id; empty = the current/last meeting"},
         "use_sample": {"type": "boolean", "description": "true only after the user agreed to use the sample recording"}},
        ["room_id", "use_sample"],
    ),
    _fn(
        "weris_report",
        "The user's WERIS individual weekly report. status: opens the form and returns every item (key, name, kind, "
        "last week's promise, complete). fill: drafts the English text of the items with one call (from the request, "
        "last week's promises and this week's real data), fills the cards visibly and saves the draft; returns what was "
        "filled and which items need review. Not sensitive (submitting is: weris.report.submit).",
        {
            "action": {"type": "string", "enum": ["status", "fill"]},
            "request": {"type": "string", "description": "The user's own words for fill ('' for status)"},
            "scope": {"type": "string", "enum": ["all", "mentioned", "keys"], "description": "all items, the items the request mentions, or exactly keys"},
            "keys": {"type": "array", "items": {"type": "string"}, "description": "Item keys for scope keys, else []"},
        },
        ["action", "request", "scope", "keys"],
    ),
    _fn("katibu_status", "Progress of the latest Katibu minutes jobs.", {}, []),
    _fn(
        "katibu_open_minutes",
        "Open minutes in NURU Hub.",
        {"job_id": {"type": "integer", "description": "0 = the latest"}},
        ["job_id"],
    ),
    _fn(
        "katibu_send_minutes",
        "Approve the minutes and e-mail them to the participants through KatibuAI. SENSITIVE: ask_confirmation first.",
        {"job_id": {"type": "integer", "description": "0 = the latest ready minutes"}},
        ["job_id"],
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
