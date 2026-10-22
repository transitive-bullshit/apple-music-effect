# Made by Sound, Made by Code

> A real-time recreation of the liquid logo animation from Apple Music's new identity: a physically based oil-and-glass simulation that runs in the browser and works with any logo.

[![The demo brand in the simulation: an equalizer icon in a glass tile, and a wordmark under a lens of oil](docs/preview.jpg)](explainer.html)

Apple filmed its new mark in a tray of mineral oil, rippled by a two-note sting from Fred again.. and NEST Acoustics. This repo rebuilds the effect with a GPU simulation: a dome of oil that magnifies the logo, a shallow-water surface for the waves, a Liquid Glass tile, and spectral ray tracing for the rainbow fringes, matched frame by frame against Apple's film.

- **Player:** drop in your own icon and wordmark, tune the oil and the light, export an MP4 (1080p or 4K) from the browser.
- **Explainer:** how the original was made, why it looks the way it does, and how to make your own, in code or in a dish of oil (`explainer.html`).
- **Renderer:** deterministic headless renders and a comparison harness against the reference film.

## Getting started

Paste this into a coding agent:

```
Clone https://github.com/transitive-bullshit/apple-music-effect, install it (Node 24+, pnpm,
uv, ffmpeg and Google Chrome), and run `pnpm dev`. Open the player, drop my icon and wordmark
onto it, and export a 1080p MP4. Read contributing.md for the render and comparison commands.
```

## License

The code is [MIT](license) © [Travis Fischer](https://x.com/transitive_bs). This is an unofficial study, not affiliated with Apple. Apple and Apple Music are trademarks of Apple Inc.; the repo ships only its own demo brand, and Apple's film, music and logos are not included.

---

Want to run it, change it, or see where everything lives? See [contributing.md](contributing.md).
