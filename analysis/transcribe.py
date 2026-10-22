"""Transcribe a reference video with word-level timings (Whisper on MLX, Apple Silicon only).

    uv run --group analysis python analysis/transcribe.py reference/youtube/apple-music-identity.mkv

Writes <video>.transcript.json (segments with words and their start/end seconds) and a readable
<video>.transcript.txt next to the video. Both stay in reference/, which isn't in git: the
transcript is someone else's words.
"""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

MODEL = "mlx-community/whisper-large-v3-turbo"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", type=Path)
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()

    import mlx_whisper

    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", args.video, "-ac", "1", "-ar", "16000", wav],
            check=True,
        )
        # music beds make Whisper loop on made-up lines: don't carry text forward, skip long
        # silences, and drop segments it isn't confident hold speech
        result = mlx_whisper.transcribe(
            str(wav),
            path_or_hf_repo=args.model,
            word_timestamps=True,
            language="en",
            condition_on_previous_text=False,
            hallucination_silence_threshold=2.0,
        )

    speech = [
        s
        for s in result["segments"]
        if s["text"].strip() and s["no_speech_prob"] < 0.6 and s["avg_logprob"] > -1.0
    ]
    segments = [
        {
            "start": round(s["start"], 3),
            "end": round(s["end"], 3),
            "text": s["text"].strip(),
            "words": [
                {"start": round(w["start"], 3), "end": round(w["end"], 3), "word": w["word"].strip()}
                for w in s.get("words", [])
            ],
        }
        for s in speech
    ]
    out = args.video.with_suffix(".transcript.json")
    out.write_text(json.dumps({"model": args.model, "segments": segments}, indent=2) + "\n")
    lines = [f"[{s['start']:7.2f}-{s['end']:7.2f}] {s['text']}" for s in segments]
    args.video.with_suffix(".transcript.txt").write_text("\n".join(lines) + "\n")
    print(f"wrote {out} ({len(segments)} segments)")


if __name__ == "__main__":
    main()
