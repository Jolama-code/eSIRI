"""Generates a short Swahili test meeting (OpenAI TTS, fictional people) for the live-recording KatibuAI test.

Its content differs from the sample meeting: a budget committee decides to buy ten computers and names who is
responsible. The WAV is used as Chrome's fake microphone (--use-file-for-fake-audio-capture).

    backend/.venv/bin/python backend/scripts/make_test_meeting.py <out.wav>
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

LINES = [
    ("coral", "Habari zenu wajumbe. Karibuni kwenye kikao cha kamati ya bajeti ya idara ya TEHAMA. "
              "Ajenda yetu leo ni moja tu: ununuzi wa kompyuta mpya kwa ajili ya ofisi."),
    ("ash", "Asante Mwenyekiti. Kwa sasa wafanyakazi wapya kumi hawana kompyuta. Napendekeza tununue kompyuta kumi "
            "mpya za mezani, kila moja ikiwa na kumbukumbu ya gigabaiti kumi na sita."),
    ("sage", "Naunga mkono pendekezo hilo. Bajeti ya robo hii inatosha. Gharama inakadiriwa kuwa shilingi milioni "
             "ishirini na tano kwa kompyuta zote kumi."),
    ("coral", "Vizuri. Basi kamati imeamua kununua kompyuta kumi. Bwana Juma Hassan atakuwa msimamizi wa ununuzi huo, "
              "na atawasilisha taarifa ya maendeleo kabla ya Ijumaa ijayo."),
    ("ash", "Nimepokea jukumu hilo. Nitawasiliana na kitengo cha manunuzi kesho asubuhi, na kompyuta zitafika ndani ya "
            "wiki mbili."),
    ("coral", "Asanteni wote. Uamuzi wetu ni kununua kompyuta kumi, na Juma Hassan ndiye anayehusika. Kikao kimefungwa."),
]


def main(out: Path) -> None:
    client = OpenAI()
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, (voice, text) in enumerate(LINES):
            mp3 = Path(tmp) / f"{i}.mp3"
            with client.audio.speech.with_streaming_response.create(model="gpt-4o-mini-tts", voice=voice, input=text,
                                                                    instructions="Speak natural Tanzanian Swahili at a calm meeting pace.") as r:
                r.stream_to_file(mp3)
            parts.append(mp3)
        lst = Path(tmp) / "list.txt"
        lst.write_text("".join(f"file '{p}'\n" for p in parts))
        out.parent.mkdir(parents=True, exist_ok=True)
        # 1 s of silence at the end so Chrome's looping fake microphone has a clear gap.
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                        "-af", "apad=pad_dur=1", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", str(out)], check=True)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
