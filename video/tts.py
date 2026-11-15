"""Generate the voiceover, one file per scene, with word timings for captions.

    python video/tts.py

Writes video/build/vo/<scene>.mp3 and <scene>.json (sentence cues with start/end in seconds),
and prints each scene's length and the total.
"""
import asyncio
import json
import os
import subprocess
import sys

import edge_tts

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "build", "vo")
FFMPEG = os.path.join(ROOT, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe")


def duration(path: str) -> float:
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", path], capture_output=True, text=True)
    for line in r.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            h, m, s = line.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    raise RuntimeError(f"no duration for {path}")


def chunk_words(words, max_chars=58):
    """Group word boundaries into caption cues of at most max_chars, breaking after punctuation when possible."""
    cues, cur = [], []
    for w in words:
        cur.append(w)
        text = " ".join(x["text"] for x in cur)
        if len(text) >= max_chars or w["text"][-1:] in ".?!:" or (w["text"][-1:] == "," and len(text) > 34):
            cues.append(cur)
            cur = []
    if cur:
        cues.append(cur)
    return [
        {"start": c[0]["start"], "end": c[-1]["end"], "text": " ".join(x["text"] for x in c)}
        for c in cues
    ]


def restore_punctuation(words, text):
    """Word boundaries come without punctuation; take each word's spelling from the script instead."""
    import re
    norm = lambda w: re.sub(r"[^0-9a-z]", "", w.lower())
    tokens = text.split()
    out, j = [], 0
    for w in words:
        target = norm(w["text"])
        k = j
        while k < len(tokens) and norm(tokens[k]) != target and not norm(tokens[k]).startswith(target):
            k += 1
        if k < len(tokens):
            # A hyphenated script token may arrive as several boundaries: keep the token once.
            if out and out[-1].get("_tok") == k:
                out[-1]["end"] = w["end"]
                continue
            out.append({**w, "text": tokens[k], "_tok": k})
            j = k + (0 if norm(tokens[k]) != target else 1)
        else:
            out.append(w)
    for o in out:
        o.pop("_tok", None)
    return out


async def one(scene, voice, rate):
    os.makedirs(OUT, exist_ok=True)
    mp3 = os.path.join(OUT, f"{scene['id']}.mp3")
    words = []
    comm = edge_tts.Communicate(scene["text"], voice, rate=rate, boundary="WordBoundary")
    with open(mp3, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 1e7
                words.append({"start": start, "end": start + chunk["duration"] / 1e7, "text": chunk["text"]})
    cues = chunk_words(restore_punctuation(words, scene["text"]))
    d = duration(mp3)
    with open(os.path.join(OUT, f"{scene['id']}.json"), "w", encoding="utf-8") as f:
        json.dump({"duration": d, "cues": cues}, f, indent=1)
    return d


async def main():
    cfg = json.load(open(os.path.join(ROOT, "script.json"), encoding="utf-8"))
    only = set(sys.argv[1:])
    total = 0.0
    for s in cfg["scenes"]:
        if only and s["id"] not in only:
            d = json.load(open(os.path.join(OUT, f"{s['id']}.json"), encoding="utf-8"))["duration"]
        else:
            for attempt in range(4):
                try:
                    d = await one(s, cfg["voice"], cfg["rate"])
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt == 3:
                        raise
                    await asyncio.sleep(2 + attempt * 3)
        total += d
        print(f"{s['id']:10s} {d:6.2f}s  {len(s['text'].split())} words")
    print(f"{'total':10s} {total:6.2f}s")


asyncio.run(main())
