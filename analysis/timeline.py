"""Write data/timeline.json, the song's timeline that the renderer draws against.

    uv run --group analysis python analysis/timeline.py media/song.mp3
    uv run python analysis/timeline.py   # a silent 120 bpm placeholder, no audio needed

The renderer validates the same shape with zod (src/timeline.ts); keep the two in step.
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "timeline.json"
KEYS = {"audio", "duration", "tempo", "beats"}


def build(duration: float, beats: list[float], tempo: float, audio: str | None) -> dict:
    """A timeline: times in seconds from the start of the audio, rounded to the millisecond."""
    return {
        "audio": audio,
        "duration": round(duration, 3),
        "tempo": round(tempo, 2),
        "beats": sorted({round(b, 3) for b in beats if 0 <= b < duration}),
    }


def validate(timeline: dict) -> None:
    """Raise ValueError unless the renderer would accept this timeline."""
    if set(timeline) != KEYS:
        raise ValueError(f"expected keys {sorted(KEYS)}, got {sorted(timeline)}")
    audio, duration, tempo, beats = (timeline[k] for k in ("audio", "duration", "tempo", "beats"))
    if audio is not None and not isinstance(audio, str):
        raise ValueError("audio must be a path relative to the repo root, or null")
    if not duration > 0 or not tempo > 0:
        raise ValueError("duration and tempo must be positive")
    if any(not 0 <= b < duration for b in beats):
        raise ValueError("beats must fall within [0, duration)")
    if any(a >= b for a, b in zip(beats, beats[1:])):
        raise ValueError("beats must be strictly increasing")


def analyze(path: Path) -> dict:
    """Beats and tempo of the song at `path`, which must live under the repo (media/)."""
    # librosa is in the optional analysis group, so the tests run without it
    import librosa
    import numpy as np

    audio = path.resolve().relative_to(ROOT).as_posix()
    y, sr = librosa.load(path, sr=None, mono=True)
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr)
    beats = librosa.frames_to_time(frames, sr=sr)
    return build(len(y) / sr, beats.tolist(), float(np.atleast_1d(tempo)[0]), audio)


def placeholder(duration: float = 8.0, tempo: float = 120.0) -> dict:
    """A steady beat grid with no audio, for working on the renderer before there's a song."""
    step = 60 / tempo
    return build(duration, [i * step for i in range(round(duration / step))], tempo, None)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("audio", nargs="?", type=Path, help="the song, under media/")
    args = parser.parse_args()
    timeline = analyze(args.audio) if args.audio else placeholder()
    validate(timeline)
    OUT.write_text(json.dumps(timeline, indent=2) + "\n")
    print(
        f"wrote {OUT.relative_to(ROOT)}: {timeline['duration']} s, "
        f"{len(timeline['beats'])} beats at {timeline['tempo']} bpm"
    )


if __name__ == "__main__":
    main()
