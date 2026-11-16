"""Edit the recorded scenes into the final demo video.

    python video/compose.py [--draft]

Reads video/script.json, video/build/vo/*, video/build/frames/<scene>/frames.json.
Writes video/build/fenestella-demo.mp4 (1920x1080, 30 fps, H.264 + AAC).

For each scene: the spans where the page only waited for the chain are cut, the
rest is fitted to the narration (sped up slightly when longer, held on the last
frame when shorter). Scenes are joined with transitions; captions and chapter
labels are burned in from an ASS file; the voice sits on a quiet synthesized
pad that ducks under it.
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(ROOT, "build")
FFMPEG = os.path.normpath(os.path.join(ROOT, "..", "node_modules", "ffmpeg-static", "ffmpeg.exe"))
FPS = 30
DRAFT = "--draft" in sys.argv
LEAD = 0.45   # silence before the voice starts in a scene
TAIL = 0.80   # picture after the voice ends
MAX_SPEED = 1.50

# Transition into each scene (by index), and its length.
TRANSITIONS = {
    "landing": ("fadeblack", 0.9),
    "account": ("smoothleft", 0.6),
    "connect": ("fade", 0.5),
    "window": ("smoothup", 0.6),
    "agent": ("smoothleft", 0.6),
    "ai": ("smoothup", 0.6),
    "mandate": ("fade", 0.5),
    "attack": ("fade", 0.5),
    "dapps": ("smoothleft", 0.6),
    "docs": ("fade", 0.5),
    "outro": ("fadeblack", 0.9),
}


def run(args, cwd=None):
    r = subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y", *args], cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit(f"ffmpeg failed: {' '.join(args[:6])} ...")


def kept_intervals(meta):
    start = meta["marks"].get("go", 0.0)
    end = meta["end"]
    spans = []
    cur = start
    for a, b in sorted(meta["cuts"]):
        if b <= cur:
            continue
        if a > cur:
            spans.append((cur, min(a, end)))
        cur = max(cur, b)
    if cur < end:
        spans.append((cur, end))
    return [(a, b) for a, b in spans if b - a > 0.04]


def frame_list(meta, scene_dir):
    """Concat-demuxer entries (file, duration) for the kept parts of the timeline."""
    frames = meta["frames"]
    periods = []
    for i, f in enumerate(frames):
        t1 = frames[i + 1]["t"] if i + 1 < len(frames) else meta["end"]
        periods.append((f["file"], f["t"], max(t1, f["t"])))
    out = []
    for a, b in kept_intervals(meta):
        for file, s, e in periods:
            lo, hi = max(s, a), min(e, b)
            if hi - lo > 1e-4:
                out.append((file, hi - lo))
        # If the interval starts before the first frame, hold the first frame.
    length = sum(d for _, d in out)
    lines = ["ffconcat version 1.0"]
    for file, d in out:
        lines.append(f"file '{os.path.join(scene_dir, file).replace(os.sep, '/')}'")
        lines.append(f"duration {d:.4f}")
    if out:
        lines.append(f"file '{os.path.join(scene_dir, out[-1][0]).replace(os.sep, '/')}'")
    return "\n".join(lines) + "\n", length


def build_scene(scene, vo_dur):
    sdir = os.path.join(BUILD, "frames", scene)
    meta = json.load(open(os.path.join(sdir, "frames.json"), encoding="utf-8"))
    listing, length = frame_list(meta, sdir)
    lst = os.path.join(BUILD, "clips", f"{scene}.ffconcat")
    os.makedirs(os.path.dirname(lst), exist_ok=True)
    open(lst, "w", encoding="utf-8").write(listing)
    target = vo_dur + LEAD + TAIL
    speed = 1.0
    if length > target:
        speed = min(MAX_SPEED, length / target)
    out_len = length / speed
    pad = max(0.0, target - out_len)
    final = out_len + pad
    vf = [f"setpts=PTS/{speed:.5f}", f"fps={FPS}", "scale=1920:1080:flags=lanczos", "format=yuv420p"]
    if pad > 0:
        vf.insert(2, f"tpad=stop_mode=clone:stop_duration={pad:.3f}")
    out = os.path.join(BUILD, "clips", f"{scene}.mp4")
    run([
        "-f", "concat", "-safe", "0", "-i", lst,
        "-vf", ",".join(vf),
        "-t", f"{final:.3f}",
        "-c:v", "libx264", "-preset", "veryfast" if DRAFT else "medium", "-crf", "24" if DRAFT else "15",
        "-pix_fmt", "yuv420p", "-an", out,
    ])
    print(f"  {scene:8s} recorded {length:6.2f}s  speed {speed:4.2f}  pad {pad:5.2f}s  -> {final:6.2f}s (voice {vo_dur:5.2f}s)")
    return out, final


def ass_time(t):
    t = max(0.0, t)
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def ass_escape(text):
    return text.replace("{", "(").replace("}", ")")


def write_ass(scenes, starts, cues_by_scene, path):
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Segoe UI Semibold,40,&H00E2EEF3,&H00E2EEF3,&H00070706,&H5A070706,0,0,0,0,100,100,0,0,3,14,0,2,200,200,62,1
Style: ChapNum,Segoe UI Semibold,22,&H00AECF6F,&H00AECF6F,&H00000000,&H00000000,0,0,0,0,100,100,3,0,1,0,0,7,0,0,0,1
Style: ChapTitle,Segoe UI Semibold,38,&H00E2EEF3,&H00E2EEF3,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: ChapBox,Segoe UI,10,&HB4070706,&HB4070706,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    n = 0
    for i, sc in enumerate(scenes):
        st = starts[i]
        if sc.get("title"):
            n += 1
            a, b = st + 0.35, st + 3.6
            w = 64 + int(len(sc["title"]) * 20.5)
            y = 150
            box = f"{{\\an7\\pos(48,{y})\\fad(350,450)\\p1\\bord0\\shad0\\1c&H070706&\\1a&H30&}}m 0 0 l {w} 0 {w} 108 0 108{{\\p0}}"
            bar = f"{{\\an7\\pos(48,{y})\\fad(350,450)\\p1\\bord0\\shad0\\1c&HAECF6F&}}m 0 0 l 5 0 5 108 0 108{{\\p0}}"
            ev.append(f"Dialogue: 1,{ass_time(a)},{ass_time(b)},ChapBox,,0,0,0,,{box}")
            ev.append(f"Dialogue: 2,{ass_time(a)},{ass_time(b)},ChapBox,,0,0,0,,{bar}")
            ev.append(f"Dialogue: 3,{ass_time(a)},{ass_time(b)},ChapNum,,0,0,0,,{{\\move(52,{y + 14},78,{y + 14},0,450)\\fad(350,450)}}{n:02d}")
            ev.append(f"Dialogue: 3,{ass_time(a + 0.08)},{ass_time(b)},ChapTitle,,0,0,0,,{{\\move(52,{y + 42},78,{y + 42},0,500)\\fad(380,450)}}{ass_escape(sc['title'])}")
        for c in cues_by_scene[sc["id"]]:
            a = st + LEAD + c["start"]
            b = st + LEAD + c["end"] + 0.18
            ev.append(f"Dialogue: 0,{ass_time(a)},{ass_time(b)},Cap,,0,0,0,,{{\\fad(120,120)}}{ass_escape(c['text'])}")
    open(path, "w", encoding="utf-8").write(head + "\n".join(ev) + "\n")


def main():
    cfg = json.load(open(os.path.join(ROOT, "script.json"), encoding="utf-8"))
    scenes = cfg["scenes"]
    vo = {s["id"]: json.load(open(os.path.join(BUILD, "vo", f"{s['id']}.json"), encoding="utf-8")) for s in scenes}

    print("Scenes")
    clips = [build_scene(s["id"], vo[s["id"]]["duration"]) for s in scenes]

    # Timeline with transitions.
    starts = [0.0]
    for i in range(1, len(scenes)):
        _, d = TRANSITIONS.get(scenes[i]["id"], ("fade", 0.5))
        starts.append(starts[i - 1] + clips[i - 1][1] - d)
    total = starts[-1] + clips[-1][1]

    # Captions and chapter labels.
    fonts = os.path.join(BUILD, "fonts")
    os.makedirs(fonts, exist_ok=True)
    for f in ("segoeui.ttf", "seguisb.ttf", "segoeuib.ttf"):
        src = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", f)
        if os.path.exists(src):
            shutil.copy(src, fonts)
    write_ass(scenes, starts, {k: v["cues"] for k, v in vo.items()}, os.path.join(BUILD, "captions.ass"))

    # Video graph: chain xfades.
    inputs = []
    for path, _ in clips:
        inputs += ["-i", path]
    graph = []
    prev = "[0:v]"
    acc = clips[0][1]
    for i in range(1, len(clips)):
        kind, d = TRANSITIONS.get(scenes[i]["id"], ("fade", 0.5))
        offset = acc - d
        out = f"[v{i}]"
        graph.append(f"{prev}[{i}:v]xfade=transition={kind}:duration={d}:offset={offset:.3f}{out}")
        prev = out
        acc = offset + clips[i][1]
    graph.append(f"{prev}subtitles=captions.ass:fontsdir=fonts,format=yuv420p[vout]")

    # Audio: voice per scene, a quiet pad, ducked under the voice.
    n = len(clips)
    for s in scenes:
        inputs += ["-i", os.path.join(BUILD, "vo", f"{s['id']}.mp3")]
    pad_expr = (
        "0.22*sin(2*PI*110*t)+0.16*sin(2*PI*164.81*t)+0.12*sin(2*PI*220*t)"
        "+0.08*sin(2*PI*277.18*t)*(0.6+0.4*sin(2*PI*0.07*t))+0.06*sin(2*PI*329.63*t)*(0.5+0.5*sin(2*PI*0.05*t+1))"
    )
    graph.append(
        f"aevalsrc='{pad_expr}':s=48000:d={total:.2f},lowpass=f=900,aecho=0.8:0.7:420|660:0.25|0.18,"
        f"volume=0.16,afade=t=in:d=3,afade=t=out:st={total - 4:.2f}:d=4,aformat=channel_layouts=stereo[padraw]"
    )
    voices = []
    for i, s in enumerate(scenes):
        delay = int((starts[i] + LEAD) * 1000)
        graph.append(f"[{n + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={delay}|{delay},apad=whole_dur={total:.2f}[a{i}]")
        voices.append(f"[a{i}]")
    graph.append(f"{''.join(voices)}amix=inputs={len(voices)}:normalize=0:duration=longest,volume=1.35[voice]")
    graph.append("[voice]asplit=2[vmain][vkey]")
    graph.append("[padraw][vkey]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=600[pad]")
    graph.append("[vmain][pad]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]")

    out = os.path.join(BUILD, "fenestella-demo-draft.mp4" if DRAFT else "fenestella-demo.mp4")
    run([
        *inputs,
        "-filter_complex", ";".join(graph),
        "-map", "[vout]", "-map", "[aout]",
        "-t", f"{total:.3f}",
        "-c:v", "libx264", "-preset", "veryfast" if DRAFT else "medium", "-crf", "24" if DRAFT else "17",
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        out,
    ], cwd=BUILD)
    print(f"\nWrote {out}  ({total:.1f}s)")


main()
