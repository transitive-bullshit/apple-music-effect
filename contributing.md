# Contributing

## Setup

- Node 24+, pnpm, [uv](https://docs.astral.sh/uv/), ffmpeg, Google Chrome (renders drive the installed Chrome through Playwright), and ImageMagick for the comparison sheets.
- `pnpm install` and `uv sync`. The analysis tools need the optional group: `uv run --group analysis …` (librosa, mlx-whisper on Apple Silicon, OpenCV, potracer, matplotlib).
- `pnpm dev` serves through [portless](https://portless.sh) at https://apple-music-effect.localhost; `PORTLESS=0 pnpm dev` serves http://127.0.0.1:5215. The player is `/`, the explainer `/explainer.html`.
- No API keys or environment variables.

## Reference material (not in git)

Matching Apple's film needs the film itself and its logos, all local-only in `reference/` and `media/` (except the sting, `media/sting-reel.wav`, which is committed):

```bash
# Apple's behind-the-scenes film (1080p) and the 4 s reel with the sting
yt-dlp -f "270+bestaudio" --merge-output-format mkv -o "reference/youtube/apple-music-identity.%(ext)s" "https://www.youtube.com/watch?v=1XxNXkOHKZw"
yt-dlp -o "reference/instagram/apple-music-reel.%(ext)s" "https://www.instagram.com/reels/DewrnLVuEUp/"
ffmpeg -i reference/instagram/apple-music-reel.mp4 -vn -ac 1 -ar 48000 media/sting-reel.wav

# transcript with word timings, and the sting's timeline (writes data/timeline.json)
uv run --group analysis python analysis/transcribe.py reference/youtube/apple-music-identity.mkv
uv run --group analysis python analysis/timeline.py media/sting-reel.wav

# the dome's curves, fitted to the refraction measured in the film (writes data/dome/<shot>.json;
# the registration takes ~20 min a shot, --fit refits its saved result in seconds)
uv run --group analysis python analysis/capture.py icon
uv run --group analysis python analysis/capture.py icon --fit

# the new note and wordmark, traced from still frames of the film (frames/yt from ffmpeg)
uv run --group analysis python analysis/trace.py frames/ref-icon/r-1.24.png --roi 815,365,280,355 --out reference/brand/traced/note-yt.svg
uv run --group analysis python analysis/trace.py frames/yt/f_00151.png … frames/yt/f_00172.png --out reference/brand/traced/wordmark-yt.svg
```

Without them the player and renders fall back to the demo brand in `public/demo/`.

## Commands

```bash
pnpm dev                                    # the player and the explainer
pnpm render --stills 0.6,2.2 --out renders/stills
pnpm render --from 0 --to 4 --out renders/sting.mp4                       # 1080p with the sting
pnpm render --w 3840 --h 2160 --out renders/sting-4k.mp4                    # 4K
pnpm render --query "icon=demo/icon.svg&wordmark=demo/wordmark.svg" --out renders/demo.mp4

# how closely a render follows the film, as smoothed curves per shot (lower is closer)
uv run --group analysis python analysis/scorecard.py before=renders/a.mp4 now=renders/b.mp4 --chart renders/scorecard.png

# beside Apple's film: reference frames on top, the simulation below
pnpm compare --times 0.17,0.33,0.6,1 --crop 560,140,800,800 --out renders/compare/icon.png
pnpm compare --shot wordmark --step 0.125 --crop 410,330,1100,420

# score parameter sets by pixel error against the film (a rough guide; see docs/effect-analysis.md)
pnpm score --times 0.6,0.8,1 --query "p0.lensEdge=0.4" --query "p0.lensEdge=0.6"
```

Any page takes `?p.name=value` (every shot) or `?p1.name=value` (the second shot) to override a parameter, `?icon=` and `?wordmark=` to swap logos, and in render mode `?debug=1,2,4,5` (surface height, slope, ray offset, offset direction) with `&debugScale=`.

## Where things live

| Part | Code |
| --- | --- |
| The film: shots, their curves, every parameter | `src/scene.ts` |
| The dome: its curves, fitted to the film | `src/dome.ts`, `data/dome/`, `analysis/capture.py` |
| Keyframe interpolation, the rig's wobble | `src/driver.ts` |
| Engine: oil stepping, subframes, bloom | `src/engine.ts` |
| Shaders: the dome, optics, finish | `src/shaders.ts` |
| WebGL2 helpers | `src/gl.ts` |
| Logos: rasterizing, masks, distance fields | `src/assets.ts` |
| Fitting any logo to a shot, the demo brand | `src/brand.ts`, `public/demo/` |
| Player, panel, MP4 export | `src/player.ts`, `src/panel.ts`, `src/export.ts` |
| Explainer | `explainer.html`, `src/explainer.ts` |
| Headless render, comparison, scoring | `scripts/render.ts`, `scripts/compare.ts`, `scripts/score.ts` |
| Analysis: transcript, sting timeline, tracing, capture | `analysis/` |
| What the film shows, the physics, how it was matched | `docs/effect-analysis.md` |

## Tuning a moment

1. Find the shot and its curves in `src/scene.ts` (shot time = film time − the shot's start). The dome's four curves and two profiles are in `data/dome/<shot>.json`, written by `analysis/capture.py`: edit their key times and hand-set values at the top of the script, then refit (`--fit`, seconds).
2. `pnpm compare --times <film times> --crop …` to see it beside the film; try values with `--query "p0.name=value"` first.
3. Keep it to a few curves with a few keys each: more keys bring back the jitter (`test/smooth.test.ts` caps them).
4. Move what works into `src/scene.ts` (or the script) and compare again.

## Tests

- `pnpm test`: format, lint, types, and `test/` (keyframe interpolation, the wobble, the film's timeline, the fits, that every animated value is smooth, the sting timeline).
- `uv run pytest -q`: `tests/` (the committed timeline).
- CI runs both, plus `pnpm build` and `py_compile`, offline. Renders and comparisons need Chrome and the reference film, so they stay local.

## Deploy

The site deploys to Vercel from GitHub: every push to `main` builds production (https://apple-music-effect.vercel.app), other branches get preview URLs. `vercel.json` sets the Vite build, clean URLs and the caching (hashed `assets/` immutable for a year, other static files a day, HTML revalidated on every visit). The project pins pnpm through Corepack (`ENABLE_EXPERIMENTAL_COREPACK=1`), and Web Analytics loads only on the built site (`src/analytics.ts`). The share image, icons, `robots.txt`, `sitemap.xml` and `llms.txt` live in `public/`.

Deployed, there's no reference material, so the site shows the demo brand, with the sting (the build copies the file `data/timeline.json` names to the same path in `dist/`).

## Not in the repo, on purpose

- `reference/` and `media/`: Apple's film, reel and logos (including the traced ones), which are Apple's copyrighted work and trademarks. The sting is the one file in `media/` that's committed.
- `frames/`, `renders/`, `dist/`: regenerable output.
