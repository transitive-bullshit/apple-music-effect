# Project: apple-music-effect

A custom video renderer for the Apple Music effect, with a live preview player in the browser. A working directory: Python analysis plus a TypeScript renderer. See `contributing.md` for setup and commands.

## Conventions

- use `pnpm`
- use modern TypeScript (ESM only, no CommonJS)
- no semicolons; oxfmt formats (`pnpm fix:format`) and oxlint lints (`pnpm fix:lint`)
- `pnpm test` runs format, lint, types, and unit tests; keep it green
- use `ky` as a wrapper around `fetch` for HTTP requests
- use `zod` to validate external data
- for local development, use `pnpm dev` and the Portless URL it prints (apps only)
- use `uv` for the Python analysis (`analysis/`)

## Mental model

song (`media/`, not in git) → analysis (`analysis/timeline.py`) → `data/timeline.json` (committed) → `drawFrame` in `src/frame.ts`, a pure function of song time → one page (`index.html`, `src/main.ts`) with two modes:

- preview (default): the player (`src/player.ts`, `src/clock.ts`) draws live, in sync with the audio
- render (`?mode=render`): `scripts/render.ts` drives it in headless Chrome and pipes each frame to ffmpeg with the matching slice of the song → `renders/`

`src/frame.ts` is a placeholder look; the effect itself is still to be built.

## Rules

- Keep frames deterministic: no `Math.random()` or wall-clock time in `src/frame.ts`; seed anything random. The preview, stills and renders must agree.
- The audio is the master: never edit or re-time it. Timing comes from `data/timeline.json`.
- `data/timeline.json` is generated: rerun `analysis/timeline.py` instead of editing it by hand. Its shape is a contract between `validate` in `analysis/timeline.py` and `TimelineSchema` in `src/timeline.ts`; change both together. Tests in both languages check the committed file.

## Not in git

- `media/` (the song) and `reference/`: copyrighted source material, never committed. A fresh clone plays and renders silent until the song is in `media/`.
- `renders/`, `dist/`, `analysis/out/`: regenerable output.
- `readme.md` is marketing; technical docs go in `contributing.md`.

## Checks

`pnpm test` and `uv run pytest -q`; CI also runs `pnpm build` and `py_compile`, offline. `uv sync` prunes `.venv` to the groups you name, so run the analysis with `uv run --group analysis`.
