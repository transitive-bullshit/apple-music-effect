# The Apple Music "Made by Sound" effect: analysis and simulation design

What the reference shows, how it was made physically, and how this repo simulates it. Sources are paraphrased; the reference media itself stays in `reference/` (not in git).

## Sources

- Apple Music, "Made by Sound: Behind the new brand identity" (YouTube `1XxNXkOHKZw`, 21 Oct 2026, 78 s). The clean black-background marks are at 69.3–73.3 s.
- Apple Music's Instagram reel `DewrnLVuEUp`: the same 4 s sting (icon, then wordmark) with its sonic logo, 1080×1920 at 23.976 fps.
- Coverage: Fast Company, Creative Boom, AppleInsider, Engadget, Wallpaper*, LBB, ThePrint, iSpazio (all 21–22 Oct 2026).
- Apple's 2020 icon pack (apple.co/am-icon-2020) for the note and tile vectors; the new lowercase wordmark is traced from the film (`analysis/trace.py`), since no official vector of it was published yet.

## How it was made (per the film and coverage)

- A custom rig and software drive a transducer, which turns an audio signal into vibration, in a shallow bath of mineral oil. Mineral oil was chosen for its viscosity: ripples read as rippling glass. Its refractive index (about 1.47) is also close to glass and acrylic, so submerged glass nearly vanishes.
- Acrylic versions of the note and the wordmark sit in the oil (some reports say the logo was etched into the tank's glass floor). A clear cover in the shape of the app icon is mounted on the moving rig over the note.
- Fred again.. and NEST Acoustics wrote the sonic logo, broke it into notes, and played them through the rig. Few, low notes were a constraint: many or high notes moved the oil too much to read the logo.
- Shot in camera; Time Based Arts did VFX, Trafik colour and finishing.
- The behind-the-scenes footage shows the rig: a vertical rod with a disc, the rounded-square glass cover held on it over the note, concentric ring waves spreading from it, and coloured lighting during tests. The final marks are lit on black.

## The sting (reel audio)

|  | time (reel) | bass | chord | drives |
| --- | --- | --- | --- | --- |
| note 1 | 0.10–1.55 s | F♯1, 46.2 Hz | F♯ with C♯ and D above (Dmaj7/F♯) | the icon |
| glide | 1.55–1.65 s | rises a minor third |  | the cut |
| note 2 | 1.65–2.50 s, fades by 3.1 s | A1, 54.9 Hz | A with E and B above (Asus2) | the wordmark |

Both notes sit at the bottom of the audible range, consistent with "low notes only".

## What the picture does

Reel time; YouTube time is about reel + 69.32 s.

**Icon (0.17–1.50 s)**

1. 0.17 s: a small dark glass orb with a specular highlight and a thin ring around it.
2. 0.21–0.33 s: the orb grows; inside it the note appears hugely magnified (a lens), with saturated spectral fringes (yellow/orange on one side, cyan/blue/magenta on the other) along the orb's rim.
3. ~0.33 s: the orb's outline turns from a circle into the rounded square of the icon. The note is still magnified and smeared.
4. 0.33–1.2 s: the surface sloshes inside the square: distortions sweep across the note, fringes hug the walls and the note's edges, a faint glass rim shows the tile's outline with highlights.
5. ~1.2 s: settled. A crisp white note on black inside a faint glass rounded square, then a fast zoom out (scale down) to 1.46 s and a cut.

**Wordmark (1.50–2.96 s)**

1. 1.50 s: a small bright disc around a chrome ball (the rig's tip) with concentric ring ripples outside it; the letters under it are hugely magnified and warped around the ball.
2. 1.6–1.9 s: the disc grows and the magnification falls: "nus" (the middle of "music") fills it.
3. 1.9–2.4 s: the lens flattens; "music" reads at its normal size, but its ends are smeared radially (horizontally, since they lie left and right of the centre) into spectral streaks: the Apple logo trails coloured echoes to the left, the "c" stretches into a bar to the right.
4. 2.4–2.96 s: the last ring passes beyond the ends; the streaks shrink to thin coloured ticks and vanish. The wordmark holds clean.

## Physical model

Everything is consistent with one mechanism: a camera looks straight down through a moving oil surface at a bright logo on a dark floor; the surface refracts the logo, and the oil's dispersion splits the refraction by wavelength.

- **Lens:** where the surface bulges into a dome, it is a plano-convex lens: the logo below is magnified, strongly when the dome is small and steep. The rig pushes a dome-shaped glass cover up through the surface. Its top first breaks the surface at a point; the contour where it meets the oil grows as a circle, then takes the cover's footprint (the rounded square), exactly the orb-to-icon transition.
- **Rims and fringes:** where a surface meets the oil at a steep slope (the meniscus around the emerging cover, the crests of ring waves), refraction is strong and the per-wavelength offsets separate into spectra.
- **Sloshing:** over the submerged cover the oil is shallow, so waves are slow and reflect off the cover's edge: they are trapped inside the rounded square.
- **Rings:** the volume the rig displaces leaves as concentric ring waves; a passing ring smears what is under it along the ring's radius.
- **Index matching:** submerged, the glass cover nearly disappears; only its rim shows, faintly.

## Simulation design (as built)

A WebGL2 engine (float render targets, fragment-shader passes). The oil's surface is closed-form in time, so there is nothing to step: any frame is a pure function of its time, rendered in any order.

1. **The dome.** The rig's lens of oil, the whole of the surface: a superellipse footprint with the profile `H exp(-crown r² - shoulder r⁴) (1 - rho^flat)^edge`, where `r` is the round distance and `rho` the footprint's. The crown gives the interior's even magnification, the shoulder steepens it toward the rim, and the falloff is a steep rim that follows the footprint. The round part stays positive into the footprint's corners (a clamped `1 - crown r²` went flat there and cut them square). The icon's footprint is a superellipse of exponent 3.3, the film's rim line fitted at 0.4–1.1 s (3.0–3.4): rounder than the icon's own shape. Drawn at pixel resolution, so the rim stays crisp. A wave on its edge (the bubble's leading ripple, just outside its rim; the wordmark's echoes) and the rod's ripples ride on it.
2. **Four curves animate it** (`src/dome.ts`, `data/dome/<shot>.json`): its radius, its height, its morph from a circle to the footprint's squircle, and its settle from one profile to another. The icon's bubble grows into the rounded square with a magnifying crown, then settles into a flat top with a steep rim, then falls to a thin layer whose rim outlines the tile. The wordmark's orb widens and settles into a wide, low dome whose soft rim lies on the wordmark's ends; from 2.4 s it flattens and its edge pulls in to just past the ends, where its wave, travelling outward, draws echo bars of the ends that keep moving as they fade by about 3 s, as the film's do. The fit covers only the wide dome (2.04–2.4 s): the echo bars are thinner than the registration resolves, so the ending is keyed to the film by eye and by how far its light reaches past the ends. The rod's ripples decay from the shot's start and are gone once the dome settles.
3. **The reveal.** The logo is lit only within the dome's footprint (where each ray lands on the floor), as in the film.
4. **Optics.** Per pixel, refract the view ray at the surface by Snell's law for N wavelengths (Cauchy dispersion around n = 1.47), and land on the logo at depth D. Each wavelength is weighted by the CIE 1931 colour-matching functions, so partial spectra give real spectral colours (red, orange, yellow, cyan, blue, violet) and white stays white. Dispersion gathers on steep slopes: the film's colour sits on the rim's smears while the magnified interior stays clean, which no single dispersion coefficient gives (fringes grow with a ray's offset alone). The slope is capped where oil meets glass (its contact angle), so the rim refracts strongly without sweeping the whole logo. Fresnel reflection of a procedural studio: a key softbox, a fill, walls seen only at grazing angles (which light the rims), and for the wordmark a broad, soft ring light around the lens that slopes of about 0.35 catch whichever way they face, so the orb's ripples show as rings all the way round and its outline as a soft halo, as in the film. As the orb settles into the wide dome its reflections fade out slowly (the wordmark's `gloss` curve, about 0.4 s): in the film the orb's rings go first and its soft round outline lingers, still faint at 2.4 s, until the wide dome's ripple shows only where it bends the wordmark's ends, a horizontal band that fades out above and below. Its edge wave starts with the film's echoes (about 2.3 s) and is gentle enough to bend only the ends into short echoes. The rig's chrome tip is a mirrored sphere.
5. **Camera.** Eight subframes across a 180° shutter for motion blur (fewer showed fast smears as stacked copies), bloom, vignette, keyframed zoom and fade. No grain: the film has none, and its held frames are perfectly still. The spectrum's dither is seeded per subframe, not per frame, so a still picture doesn't boil.
6. **Few variables, smooth motion.** Everything that moves is one of a few curves per shot with a few keys each (the dome's four, fade, zoom, colour, and for the wordmark the edge wave and the chrome tip), interpolated by monotone cubics that ease out of their first key and into their last: continuous in value and slope (C1). `test/smooth.test.ts` checks every value by halving the sampling step (a jump doesn't shrink, a kink only halves), and that a few curves with a few keys move everything.

An earlier version simulated the oil (nonlinear shallow water on a staggered grid over a rising glass tile) and fitted the dome's values per frame. Frame by frame it was a little closer in places, but it moved in steps: the simulation ran at a fixed step behind the dome, its wet/dry fronts switched, the wordmark's ripples came from a 30 Hz oscillation that aliased at 24 fps, and per-frame fits traded one value against another from frame to frame. The film's look is the dome; dropping the rest lost little.

## How it was matched

- **Time:** YouTube = reel + 69.334 s, from cross-correlating the two clips' brightness (r = 0.992).
- **Placement:** the tile (1.24 units, 1 unit = 540 px at 1080p), the note (traced from the settled frame at 1.24 s; it's bolder than the 2020 note), the wordmark (traced from the still frames 72.3–72.7 s).
- **The dome, captured from the film** (`analysis/capture.py`): for each reel frame, a B-spline registration (SimpleITK) warps the clean logo onto the film's frame. That warp is the film's refraction field: where each pixel looks on the floor. The dome's free keys and profile values (9 for the icon, 7 for the wordmark) are fitted to every registered frame at once by least squares through the renderer's own optics, using only points that the film's edges pin down; a fit per frame first drops the points no dome explains (off by more than 30 px). Over black floor nothing constrains the warp, and at the rims it folds, so the warp itself is never rendered. The footprint is the film's bright rim line, measured per frame. Keys the film can't measure are set by hand in the script: the icon's first frames and collapse, the wordmark's orb and collapse. With so few values the fit is as close as fitting every frame's values separately was (rms 0.036 units against 0.095 with no dome for the icon, 0.014 against 0.023 for the wordmark), and the smears of the note's flag and head fall into the top-right and bottom-left corners as in the film.
- **Magnification, earlier:** the gap between the note's stems, frame by frame (1.9× at 0.42 s, 1.5× at 0.6 s, 1.0× by 1.24 s); the keyframed heights before the fit were solved from it.
- **Zoom-out:** the note's size from 1.2 s to the cut at 1.465 s.
- **Shape and light:** by eye, frame against frame (`pnpm compare`). A pixel-error sweep (`pnpm score`) helped bracket the dome's profile, but RMS error rewards a softer, darker frame, so the final choices are visual. Fitting the dome to pixels (SSIM, CMA-ES) collapsed it, since an undistorted note scores well; fitting it to the measured refraction field doesn't.
- **Colour:** the film has no lateral chromatic aberration from the lens (under 0.25 px), so all its colour is the oil's dispersion.

## Known gaps

- The film's rim fringes are still more saturated (deep red and orange on the outside of the smears); the simulation's are thinner.
- The dome is a symmetric model: the film's frame-to-frame asymmetries (a smear reaching further on one side) are fitted only on average, within about 20 px.
- Keys outside the registered frames are set by hand: the icon's first frames (before 0.21 s) and its collapse (after 1 s), and the wordmark's orb (before 2.04 s, where the chrome tip and the rod's ripples defeat the registration) and its collapse (after 2.84 s).
- The registration's B-spline mesh (control points 67 px apart) can't resolve the film's 20–40 px smear bands, so the fitted rim refracts over a broader band than the film's: late in the icon shot the smears are broad white areas where the film has thin bands. Broad smears can't vanish quickly without a jump, so the icon's collapse starts earlier (1 s) and takes six frames. A finer registration would fix both.
- How strongly the oil splits colour is keyed per shot (`colour`): the film's orb and early dome are nearly white while the smears that follow are vivid, more than one dispersion explains.
- No oil around the dome and no glass tile: the film's faint outer lines around the icon's tile and its bevel's highlights at rest aren't drawn.
- The early wordmark orb: the film's letters curl into tighter arcs around the chrome tip; the simulated ripples are more regular.
- The physical rig's exact geometry (the tile's thickness, the oil's depth) is inferred, not known; the parameters are tuned to the picture, not measured from the set.
