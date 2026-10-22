# Contributing

## Setup

- Node 24+, pnpm, [uv](https://docs.astral.sh/uv/), ffmpeg, and Google Chrome (renders drive the installed Chrome through Playwright).
- `pnpm install` and `uv sync`. The beat analysis needs librosa from the optional `analysis` group: `uv run --group analysis …`.
- `pnpm dev` serves through [portless](https://portless.sh) at https://apple-music-effect.localhost; its first run asks for sudo once, to trust a local certificate and bind port 443. `PORTLESS=0 pnpm dev` skips it and serves http://127.0.0.1:5215.
- No API keys or environment variables.

## Pipeline

```bash
# 1. put the song in media/ (not in git), then write its beats and tempo to data/timeline.json
#    (with no song yet, `uv run python analysis/timeline.py` writes a silent 120 bpm placeholder)
uv run --group analysis python analysis/timeline.py media/song.mp3

# 2. the preview player: space plays, the arrows step a frame (with shift, a beat), ?t=12.5 starts there
pnpm dev

# 3. full-resolution stills, or a clip with the matching slice of the song
pnpm render --stills 1.5,4 --out renders/stills
pnpm render --from 0 --to 8 --fps 60 --w 1920 --h 1080 --out renders/test.mp4

# 4. the player as a static site in dist/ (the song isn't bundled: copy it to dist/media/ to hear it)
pnpm build
pnpm preview
```

## Where things live

| Step | Code | Output |
| --- | --- | --- |
| Beat and tempo analysis | `analysis/timeline.py` | `data/timeline.json` |
| Timeline schema and time helpers | `src/timeline.ts` |  |
| The frame, a pure function of song time | `src/frame.ts` |  |
| Preview player and its clock | `index.html`, `src/player.ts`, `src/clock.ts`, `src/player.css` | `dist/` |
| Render mode (`?mode=render`) | `src/main.ts` |  |
| Headless renderer (Chrome, then ffmpeg x264) | `scripts/render.ts` | `renders/` |

## Changing the look

1. Edit `drawFrame` in `src/frame.ts`. It gets the canvas context, the song time and the timeline, and must draw the same picture for the same time.
2. Preview it with `pnpm dev`, which reloads on save; `?t=` jumps to a moment.
3. Check a full-resolution still: `pnpm render --stills <seconds>`.

If the look needs more from the song (sections, lyrics, loudness), extend `build` and `validate` in `analysis/timeline.py` and `TimelineSchema` in `src/timeline.ts` together, then rerun the analysis.

## Tests and CI

- `pnpm test`: format (oxfmt), lint (oxlint), types (tsc), and `test/timeline.test.ts` (the committed timeline parses; the beat and frame-time helpers).
- `uv run pytest -q`: `tests/test_timeline.py` (the committed timeline is valid; the builder sorts and clips beats).
- CI (`.github/workflows/test.yml`) runs both on every push, plus `pnpm build` and `py_compile`. It's offline: no audio, no Chrome renders, no secrets.

## Repo map

```
analysis/     Python analysis: the song -> data/timeline.json
data/         timeline.json, the committed analysis result
scripts/      render.ts, the headless renderer
src/          the renderer and the preview player
test/         TypeScript tests (vitest)
tests/        Python tests (pytest)
index.html    the player page; ?mode=render is the bare canvas the renderer captures
```

## Not in the repo, on purpose

- `media/`: the song, which is copyrighted source material. `.gitignore` also blocks audio and video by extension. Without it, the player and renders run silent.
- `reference/`: reference videos and screenshots, for the same reason.
- `renders/`, `dist/`, `analysis/out/`: regenerable output.
