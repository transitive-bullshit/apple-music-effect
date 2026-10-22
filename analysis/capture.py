"""Capture the oil's dome from Apple's film: the few smooth curves that animate it, fitted to the
refraction the film shows.

    uv run --group analysis python analysis/capture.py icon
    uv run --group analysis python analysis/capture.py icon --fit   # refit the saved registration

For each reel frame, a B-spline registration (SimpleITK) finds the smooth warp that maps the film's
pixels onto the clean logo at rest: where on the floor each pixel of the frame looks. That warp is a
refraction field. Over black floor nothing constrains it and at the rims it folds, so it is never
rendered: it only pins the dome where the film's edges do.

The dome (lensZ in src/shaders.ts) is animated by four curves over shot time: its radius, its
height, its morph from a circle to the footprint's squircle, and its settle from one profile to
another (crown, shoulder, rim falloff). Each curve has a few keys, interpolated as the renderer
does (src/driver.ts), so the motion is smooth by construction. Keys the film can't measure (before
the registration holds, the collapse) are set by hand; the rest, and any unset profile values, are
fitted to every registered frame at once by least squares through the renderer's own optics.

Writes data/dome/<shot>.json (the dome's curves and profiles, which src/scene.ts uses), the
registration in analysis/out/capture/<shot>.npz, and QA sheets (the film beside the warped logo) in
frames/capture/<shot>/.
"""

import argparse
import json
import math
import re
import subprocess
from pathlib import Path

import cv2
import numpy as np
import SimpleITK as sitk
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent.parent
FPS = 24000 / 1001
OFFSET = 69.334
PX_PER_UNIT = 540
DEPTH = 1.0  # the renderer's depth of the logo under the oil (scene.ts: depth)
IOR = 1.47  # the oil's index at the registration's (luminance) wavelength

SHOTS = {
    # the shot's start (reel time); crop in 1080p px (x, y, w, h); the clean logo: traced SVG, its rest width (px) and centre (px);
    # the first frame to capture and the frame to start from (the most reliable), in reel time
    "icon": {
        "start": 0.0,
        "crop": (560, 140, 800, 800),
        "logo": "reference/brand/traced/note-yt.svg",
        "size": (263 / 0.973, 340 / 0.973),
        "center": (952.3, 542.05),
        "times": (0.208, 1.251),
        # the frames the curves are fitted to: from 1.13 s the registration pins the tile's corner
        # highlights rather than the receding smears (and its 67 px mesh spreads them wider than
        # the film's), so the collapse is set by hand
        "fit": (0.208, 1.01),
        "seed": 0.6,
        "seedScale": 0.8,
        "dome": {
            # world units, as in src/scene.ts; the footprint's exponent at full morph: the film's rim
            # line fits a superellipse of exponent 3-3.4 (a rounder corner than the icon's own 5)
            "center": (-0.01, 0.0),
            "exponent": 3.3,
            # the profile at settle 0 (a magnifying crown) and 1 (a flat top with a steep rim);
            # None is fitted
            "from": {"crown": None, "shoulder": None, "flat": 16.0, "edge": 0.3},
            "to": {"crown": None, "shoulder": None, "flat": 16.0, "edge": 0.3},
            # [shot time, value]; None is fitted. The radius is half the width of the film's bright
            # rim line; the early height (before the registration holds) and the collapse to a
            # thin layer that keeps the tile's outline are set by hand
            "radius": [(0.05, 0.1), (0.12, 0.29), (0.21, 0.415), (0.42, 0.478), (0.75, 0.526), (1.17, 0.54)],
            "morph": [(0.28, 0.0), (0.45, 1.0)],
            "settle": [(0.21, 0.0), (0.6, None), (1.0, 1.0)],
            "height": [(0.05, 0.0), (0.12, 0.1), (0.21, None), (0.45, None), (0.75, None), (1.0, None), (1.25, 0.022)],
        },
    },
    "wordmark": {
        "start": 1.465,
        "crop": (380, 300, 1160, 480),
        "logo": "reference/brand/traced/wordmark-yt.svg",
        "size": (588, 121),
        "center": (960, 534.5),
        "times": (1.5, 2.96),
        # before 2.04 s the chrome tip and the rod's ripples fill the orb, which no dome fits;
        # after 2.4 s the film's ends turn into thin echo bars the registration can't resolve
        "fit": (2.04, 2.4),
        "seed": 2.2,
        "seedScale": 1.0,
        "dome": {
            "center": (0.0, 0.0),
            "exponent": 2.0,
            # the orb, which settles into a wide, low dome whose soft rim lies on the wordmark's ends
            "from": {"crown": 0.0, "shoulder": 0.0, "flat": 2.0, "edge": 0.8},
            "to": {"crown": 0.0, "shoulder": 0.0, "flat": None, "edge": None},
            # the orb's growth (by eye, off the film; its height so that the light it spreads off the
            # wordmark's band matches the film's) and the end are set by hand: from 2.4 s (shot
            # 0.94) the film's smears retract into the letters by about 2.6 s, so the dome flattens
            # and its edge pulls in to just past the wordmark's ends, where its wave draws the echo
            # bars that drift in and fade by 3 s
            "radius": [(0.0, 0.15), (0.135, 0.24), (0.295, 0.35), (0.375, 0.4), (0.6, None), (0.94, None), (1.2, 0.65), (1.5, 0.62), (1.8, 0.6)],
            "morph": [(0.0, 0.0)],
            "settle": [(0.375, 0.0), (0.58, 1.0)],
            "height": [(0.0, 0.0136), (0.135, 0.041), (0.295, 0.0682), (0.375, 0.0864), (0.6, None), (0.94, None), (1.2, 0.012), (1.6, 0.0)],
        },
    },
}


def reference_frame(t: float) -> Path:
    out = ROOT / "frames" / "ref" / f"ref-{t:.3f}.png"
    if not out.exists():
        out.parent.mkdir(parents=True, exist_ok=True)
        at = t + OFFSET
        src = ROOT / "reference" / "youtube" / "apple-music-identity.mkv"
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-ss", str(max(0, at - 1)), "-i", src, "-ss", str(min(1, at)), "-frames:v", "1", out],
            check=True,
        )
    return out


def luma(img: np.ndarray) -> np.ndarray:
    img = img.astype(np.float32) / 255
    return 0.2126 * img[..., 2] + 0.7152 * img[..., 1] + 0.0722 * img[..., 0]


def clean_logo(shot: dict) -> np.ndarray:
    """the logo at rest, white on black, in the crop's pixels"""
    w, h = (round(v) for v in shot["size"])
    png = ROOT / "frames" / "capture" / f"clean-{Path(shot['logo']).stem}.png"
    png.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["pnpm", "exec", "tsx", "scripts/svg-to-png.ts", shot["logo"], str(png), "--w", str(w), "--h", str(h), "--bg", "#000"],
        check=True,
        cwd=ROOT,
        capture_output=True,
    )
    logo = cv2.imread(str(png), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    frame = np.zeros((1080, 1920), np.float32)
    cx, cy = shot["center"]
    x0, y0 = round(cx - w / 2), round(cy - h / 2)
    frame[y0 : y0 + h, x0 : x0 + w] = logo
    x, y, cw, ch = shot["crop"]
    return frame[y : y + ch, x : x + cw]


def register(fixed: np.ndarray, moving: np.ndarray, sim: sitk.Similarity2DTransform, bspline: sitk.BSplineTransform | None, mesh: int):
    F = sitk.GetImageFromArray(fixed)
    M = sitk.GetImageFromArray(moving)
    # 1. the overall magnification and shift
    R = sitk.ImageRegistrationMethod()
    R.SetMetricAsMeanSquares()
    R.SetOptimizerAsRegularStepGradientDescent(1.0, 1e-4, 300)
    R.SetOptimizerScalesFromPhysicalShift()
    R.SetShrinkFactorsPerLevel([8, 4, 2])
    R.SetSmoothingSigmasPerLevel([8, 4, 2])
    R.SetInitialTransform(sim, inPlace=True)
    R.SetInterpolator(sitk.sitkLinear)
    R.Execute(F, M)
    # 2. the local warp, warm-started from the neighbouring frame's
    bs = sitk.BSplineTransformInitializer(F, [mesh, mesh], order=3)
    if bspline is not None:
        bs.SetParameters(bspline.GetParameters())
    R2 = sitk.ImageRegistrationMethod()
    R2.SetMetricAsMeanSquares()
    R2.SetOptimizerAsLBFGSB(gradientConvergenceTolerance=1e-6, numberOfIterations=200, maximumNumberOfCorrections=7)
    R2.SetShrinkFactorsPerLevel([4, 2, 1])
    R2.SetSmoothingSigmasPerLevel([4, 2, 1])
    R2.SetMovingInitialTransform(sim)
    R2.SetInitialTransform(bs, inPlace=True)
    R2.SetInterpolator(sitk.sitkLinear)
    R2.Execute(F, M)
    total = sitk.CompositeTransform([sim, bs])
    warped = sitk.GetArrayFromImage(sitk.Resample(M, F, total, sitk.sitkLinear, 0.0))
    return total, bs, warped


def slope_for(shift: np.ndarray) -> np.ndarray:
    """the surface slope that displaces a view ray by `shift` (world units) on a floor at DEPTH"""
    lo, hi = np.zeros_like(shift), np.full_like(shift, 50.0)
    for _ in range(50):
        mid = (lo + hi) / 2
        ti = np.arctan(mid)
        offset = DEPTH * np.tan(ti - np.arcsin(np.sin(ti) / IOR))
        lo, hi = np.where(offset < shift, mid, lo), np.where(offset < shift, hi, mid)
    return (lo + hi) / 2


def offsets(total: sitk.Transform, size: tuple[int, int], grid: int) -> np.ndarray:
    """where each grid point of the crop looks on the floor, relative to straight down (world units,
    y up; row 0 at the crop's bottom)"""
    w, h = size
    out = np.zeros((grid, grid, 2), np.float32)
    for j in range(grid):
        for i in range(grid):
            px = (i + 0.5) / grid * w
            py = (j + 0.5) / grid * h
            qx, qy = total.TransformPoint((px, py))
            out[grid - 1 - j, i] = ((qx - px) / PX_PER_UNIT, -(qy - py) / PX_PER_UNIT)
    return out


def weight(fixed: np.ndarray, warped: np.ndarray, grid: int) -> np.ndarray:
    """How firmly the film pins the warp, per grid point (rows as in `offsets`): where its edges and
    the warped logo's coincide. Not where the warp brings the logo somewhere the film is dark: there
    the registration has explained a reflection with the logo."""

    def edges(img: np.ndarray) -> np.ndarray:
        return cv2.GaussianBlur(np.hypot(cv2.Sobel(img, cv2.CV_32F, 1, 0), cv2.Sobel(img, cv2.CV_32F, 0, 1)), (0, 0), 4)

    pinned = np.sqrt(edges(fixed) * edges(warped))
    dragged = cv2.GaussianBlur(np.clip(warped - fixed, 0, 1), (0, 0), 8)
    w = pinned * np.clip(1 - (dragged - 0.04) / 0.12, 0, 1)
    return cv2.resize(w, (grid, grid), interpolation=cv2.INTER_AREA)[::-1]


def interpolate(keys: list[tuple[float, float]], t: np.ndarray) -> np.ndarray:
    """the renderer's keyframe curve (interpolate in src/driver.ts): a monotone cubic through the
    keys that eases out of the first and into the last, held flat beyond them"""
    ts = np.array([k[0] for k in keys], float)
    ys = np.array([k[1] for k in keys], float)
    t = np.asarray(t, float)
    n = len(keys)
    if n == 1:
        return np.full(t.shape, ys[0])
    d = np.diff(ys) / np.diff(ts)
    m = np.zeros(n)
    m[1:-1] = (d[:-1] + d[1:]) / 2
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        if a < 0:
            m[i] = 0
        if b < 0:
            m[i + 1] = 0
        r = math.hypot(a, b)
        if r > 3:
            m[i], m[i + 1] = 3 * a * d[i] / r, 3 * b * d[i] / r
    i = np.clip(np.searchsorted(ts, t, side="left") - 1, 0, n - 2)
    h = ts[i + 1] - ts[i]
    s = np.clip((t - ts[i]) / h, 0, 1)
    s2, s3 = s * s, s * s * s
    y = (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1]
    return np.where(t <= ts[0], ys[0], np.where(t >= ts[-1], ys[-1], y))


def lens_z(x: np.ndarray, y: np.ndarray, v: dict, center: tuple[float, float]) -> np.ndarray:
    """the dome's height, as lensZ in src/shaders.ts (without its ring)"""
    dx = (x - center[0] - v["shiftX"]) / v["radius"]
    dy = (y - center[1] - v["shiftY"]) / v["radius"]
    e = v["exponent"]
    rho = (np.abs(dx) ** e + np.abs(dy) ** e + 1e-12) ** (1 / e)
    r2 = dx * dx + dy * dy
    crown = np.exp(-v["crown"] * r2 - v.get("shoulder", 0.0) * r2 * r2)
    fall = np.clip(1 - np.minimum(rho, 1) ** v["flat"], 0, 1) ** v["edge"]
    return v["height"] * crown * fall


def refracted(x: np.ndarray, y: np.ndarray, v: dict, center: tuple[float, float], h: float = 0.002) -> tuple[np.ndarray, np.ndarray]:
    """where each point looks on the floor through the dome, relative to straight down, as the
    renderer's optics refract it at the oil's index"""
    z = lens_z(x, y, v, center)
    gx = (lens_z(x + h, y, v, center) - lens_z(x - h, y, v, center)) / (2 * h)
    gy = (lens_z(x, y + h, v, center) - lens_z(x, y - h, v, center)) / (2 * h)
    norm = np.sqrt(gx * gx + gy * gy + 1)
    eta = 1 / IOR
    cosi = 1 / norm
    a = eta * cosi - np.sqrt(np.maximum(1 - eta * eta * (1 - cosi * cosi), 0))
    tz = -eta + a * cosi
    reach = (z + DEPTH) / np.maximum(-tz, 1e-3)
    return a * -gx / norm * reach, a * -gy / norm * reach


# bounds and typical steps of the dome's values
BOUNDS = {"radius": (0.1, 0.9, 0.05), "height": (0.0, 0.8, 0.05), "morph": (0.0, 1.0, 0.2), "settle": (0.0, 1.0, 0.2), "crown": (0.0, 1.0, 0.2), "shoulder": (0.0, 1.0, 0.2), "flat": (2.0, 20.0, 2.0), "edge": (0.2, 3.0, 0.2)}
CURVES = ("radius", "height", "morph", "settle")
PROFILE = ("crown", "shoulder", "flat", "edge")


def dome_at(dome: dict, t: float) -> dict:
    """the dome's values at shot time t, as lensState in src/lens.ts"""
    radius, height, morph, settle = (float(interpolate(dome[c], t)) for c in CURVES)
    profile = {k: dome["from"][k] + (dome["to"][k] - dome["from"][k]) * settle for k in PROFILE}
    return {"radius": radius, "height": height, "exponent": 2 + (dome["exponent"] - 2) * morph, "shiftX": 0.0, "shiftY": 0.0, **profile}


def fit(name: str, shot: dict) -> None:
    """the dome's free keys and profile values, fitted to every registered frame at once"""
    reg = np.load(ROOT / "analysis" / "out" / "capture" / f"{name}.npz")
    spec = shot["dome"]
    center = spec["center"]
    chosen = [k for k, t in enumerate(reg["times"]) if shot["fit"][0] <= t <= shot["fit"][1]]
    times = reg["times"][chosen] - shot["start"]
    off, weights = reg["offsets"][chosen], reg["weights"][chosen]
    x, y, cw, ch = shot["crop"]
    grid = off.shape[1]
    X, Y = np.meshgrid(
        (x - 960) / PX_PER_UNIT + (np.arange(grid) + 0.5) / grid * cw / PX_PER_UNIT,
        -(y + ch - 540) / PX_PER_UNIT + (np.arange(grid) + 0.5) / grid * ch / PX_PER_UNIT,
    )

    # 1. each frame alone, its whole profile free: only to drop the points no dome explains (off by
    # more than 30 px: the registration's, not the oil's) and to seed the curves
    free = ["height", "crown", "shoulder", "flat", "edge"] + ([] if None not in [v for _, v in spec["radius"]] else ["radius"])
    lo, hi, scale = (np.array([BOUNDS[k][i] for k in free]) for i in range(3))
    points, seeds, previous = [], [], None
    for f, t in enumerate(times):
        exponent = 2 + (spec["exponent"] - 2) * float(interpolate(spec["morph"], t))
        known = {"exponent": exponent, "shiftX": 0.0, "shiftY": 0.0}
        if "radius" not in free:
            known["radius"] = float(interpolate(spec["radius"], t))
        m = weights[f] > 0.02
        if "radius" in known:
            # only inside the measured footprint
            m &= (np.abs(X - center[0]) ** exponent + np.abs(Y - center[1]) ** exponent) ** (1 / exponent) < 0.97 * known["radius"]
        px, py, ox, oy, sw = X[m], Y[m], off[f][..., 0][m], off[f][..., 1][m], np.sqrt(weights[f][m])

        def residual(u: np.ndarray) -> np.ndarray:
            qx, qy = refracted(px, py, {**known, **dict(zip(free, u))}, center)
            return np.concatenate([sw * (qx - ox), sw * (qy - oy)])

        starts = [previous] if previous is not None else []
        starts.append(np.array([{"radius": 0.5, "height": 0.15, "crown": 0.5, "shoulder": 0.2, "flat": 8.0, "edge": 0.5}[k] for k in free]))
        best = min((least_squares(residual, np.clip(s0, lo, hi), bounds=(lo, hi), loss="soft_l1", f_scale=0.02, x_scale=scale) for s0 in starts), key=lambda r: r.cost)
        previous = best.x
        seeds.append(dict(zip(free, best.x)))
        miss = np.hypot(*(best.fun / np.concatenate([sw, sw])).reshape(2, -1))
        keep = np.flatnonzero(miss < max(4 * np.median(miss), 0.055))
        if len(keep) > 3000:
            keep = np.sort(np.random.default_rng(f).choice(keep, 3000, replace=False))
        points.append((px[keep], py[keep], ox[keep], oy[keep], sw[keep]))

    # 2. the curves' free keys and the profiles' free values, against all frames at once
    slots = [(c, i) for c in CURVES for i, (_, v) in enumerate(spec[c]) if v is None]
    slots += [(end, k) for end in ("from", "to") for k in PROFILE if spec[end][k] is None]

    def seeded(slot: tuple) -> float:
        what, where = slot
        if what in CURVES:
            # the per-frame fits near the key's time (settle: halfway)
            tk = spec[what][where][0]
            if what == "settle":
                return 0.5
            near = [s.get(what) for t, s in zip(times, seeds) if abs(t - tk) < 0.1 and what in s]
            return float(np.median(near)) if near else 0.1
        first, last = seeds[0], seeds[-1]
        return float((first if what == "from" else last).get(where, 0.5))

    def bound(slot: tuple, i: int) -> float:
        what, where = slot
        return BOUNDS[what if what in CURVES else where][i]

    def assemble(u: np.ndarray) -> dict:
        dome = {**spec, **{c: list(spec[c]) for c in CURVES}, "from": dict(spec["from"]), "to": dict(spec["to"])}
        for (what, where), value in zip(slots, u):
            if what in CURVES:
                dome[what][where] = (dome[what][where][0], float(value))
            else:
                dome[what][where] = float(value)
        return dome

    def residuals(u: np.ndarray) -> np.ndarray:
        dome = assemble(u)
        out = []
        for t, (px, py, ox, oy, sw) in zip(times, points):
            qx, qy = refracted(px, py, dome_at(dome, t), center)
            out += [sw * (qx - ox), sw * (qy - oy)]
        return np.concatenate(out)

    lo, hi, scale = (np.array([bound(sl, i) for sl in slots]) for i in range(3))
    u0 = np.clip([seeded(sl) for sl in slots], lo, hi)
    result = least_squares(residuals, u0, bounds=(lo, hi), x_scale=scale)
    dome = assemble(result.x)

    total, rest_total, weight_total = 0.0, 0.0, 0.0
    for t, (px, py, ox, oy, sw) in zip(times, points):
        qx, qy = refracted(px, py, dome_at(dome, t), center)
        w2 = sw**2
        miss = float(np.sqrt(np.sum(w2 * ((qx - ox) ** 2 + (qy - oy) ** 2)) / np.sum(w2) / 2))
        rest = float(np.sqrt(np.sum(w2 * (ox**2 + oy**2)) / np.sum(w2) / 2))
        total, rest_total, weight_total = total + miss**2, rest_total + rest**2, weight_total + 1
        v = dome_at(dome, t)
        print(f"{t + shot['start']:.3f}s  {rest:.3f} -> {miss:.3f}  " + " ".join(f"{k}={v[k]:.3f}" for k in ("radius", "height", "exponent", *PROFILE)), flush=True)
    out = ROOT / "data" / "dome"
    out.mkdir(parents=True, exist_ok=True)
    record = {
        "shot": name,
        "center": list(center),
        "exponent": spec["exponent"],
        "from": {k: round(v, 4) for k, v in dome["from"].items()},
        "to": {k: round(v, 4) for k, v in dome["to"].items()},
        **{c: [[round(t, 4), round(v, 4)] for t, v in dome[c]] for c in CURVES},
        # how far the film's refraction is from none, and from this dome (rms, world units)
        "fit": {"frames": len(times), "rest": round(math.sqrt(rest_total / weight_total), 4), "miss": round(math.sqrt(total / weight_total), 4)},
    }
    # one line per key
    text = re.sub(r"\[\s+(-?[\d.]+),\s+(-?[\d.]+)\s+\]", r"[\1, \2]", json.dumps(record, indent=2))
    (out / f"{name}.json").write_text(text + "\n")
    print(f"wrote data/dome/{name}.json ({len(slots)} values fitted to {len(times)} frames)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("shot", choices=SHOTS)
    parser.add_argument("--grid", type=int, default=128)
    parser.add_argument("--mesh", type=int, default=12)
    parser.add_argument("--fit", action="store_true", help="only refit the dome to the saved registration")
    args = parser.parse_args()
    shot = SHOTS[args.shot]
    if args.fit:
        fit(args.shot, shot)
        return

    t0, t1 = shot["times"]
    times = [round(k / FPS, 3) for k in range(math.ceil(t0 * FPS - 1e-6), math.floor(t1 * FPS + 1e-6) + 1)]
    moving = clean_logo(shot)
    x, y, w, h = shot["crop"]
    qa = ROOT / "frames" / "capture" / args.shot
    qa.mkdir(parents=True, exist_ok=True)

    # from the most reliable frame outward, each frame warm-started from its neighbour
    seed = min(range(len(times)), key=lambda i: abs(times[i] - shot["seed"]))
    order = list(range(seed, len(times))) + list(range(seed - 1, -1, -1))
    fields: dict[int, np.ndarray] = {}
    weights: dict[int, np.ndarray] = {}
    state: dict[int, tuple] = {}
    for i in order:
        t = times[i]
        fixed = luma(cv2.imread(str(reference_frame(t))))[y : y + h, x : x + w]
        neighbour = state.get(i - 1) if i > seed else state.get(i + 1)
        if neighbour is None:
            sim = sitk.CenteredTransformInitializer(
                sitk.GetImageFromArray(fixed), sitk.GetImageFromArray(moving), sitk.Similarity2DTransform(), sitk.CenteredTransformInitializerFilter.GEOMETRY
            )
            sim.SetScale(shot["seedScale"])
            bspline = None
        else:
            sim = sitk.Similarity2DTransform(neighbour[0])
            bspline = neighbour[1]
        total, bs, warped = register(fixed, moving, sim, bspline, args.mesh)
        state[i] = (sim, bs)
        fields[i] = offsets(total, (w, h), args.grid)
        weights[i] = weight(fixed, warped, args.grid)
        before = float(((moving - fixed) ** 2).mean())
        after = float(((warped - fixed) ** 2).mean())
        print(f"{t:.3f}s  scale {sim.GetScale():.3f}  mse {before:.4f} -> {after:.4f}  max offset {np.abs(fields[i]).max():.2f}", flush=True)
        cv2.imwrite(str(qa / f"{t:.3f}.png"), (np.clip(np.concatenate([fixed, warped], axis=1), 0, 1) * 255).astype(np.uint8))

    out = ROOT / "analysis" / "out" / "capture"
    out.mkdir(parents=True, exist_ok=True)
    order = range(len(times))
    np.savez_compressed(out / f"{args.shot}.npz", times=np.array(times), offsets=np.stack([fields[i] for i in order]), weights=np.stack([weights[i] for i in order]))
    fit(args.shot, shot)


if __name__ == "__main__":
    main()
