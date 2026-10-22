# Apple Music Effect

> A custom video renderer for the Apple Music effect, with a live preview player in the browser.

Status: work in progress. The whole pipeline runs end to end on a placeholder look; the effect itself comes next.

## How it's made

- **Analysis (Python):** librosa finds the song's beats and tempo and writes them to a small timeline file.
- **Renderer (TypeScript):** every frame is a pure function of song time, drawn on a canvas, so a given moment always looks the same.
- **Preview player (Vite):** plays the renderer live in the browser, in sync with the song, with scrubbing and frame stepping.
- **Offline renders:** headless Chrome draws each frame at full resolution, and ffmpeg encodes it with the matching slice of the song.

## License

The code is [MIT](license) © [Travis Fischer](https://x.com/transitive_bs). No audio is included, and renders with a song's audio aren't covered by this license.

---

Want to run it, change it, or see where everything lives? See [contributing.md](contributing.md).
