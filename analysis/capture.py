"""Capture the oil's lens from Apple's film: per frame, the dome that refracts the clean logo into
what the film shows.

    uv run --group analysis python analysis/capture.py icon
    uv run --group analysis python analysis/capture.py icon --fit   # refit the saved registration

For each reel frame, a B-spline registration (SimpleITK) finds the smooth warp that maps the film's
pixels onto the clean logo at rest: where on the floor each pixel of the frame looks. That warp is a
refraction field. The renderer's dome (lensZ in src/shaders.ts, refracted as in its optics) is then
fitted to it by least squares, where the film's edges pin it down: over black floor nothing does,
and at the rims the warp folds, so the warp itself is never rendered. The dome's footprint is the
film's (its bright rim line, measured per frame), its rim's falloff fixed, and its height, crown and
centre fitted.

The animation must be smooth, so the frames are fitted together: each value is a cubic B-spline in
time, with its curvature penalised, rather than a fit per frame (which trades the crown against the
shoulder from one frame to the next and jitters). A fit per frame only seeds it and drops the points
that it can't explain.

Writes data/fit/<shot>.json (the dome per frame, which the renderer loads), the registration in
analysis/out/capture/<shot>.npz, and QA sheets (the film beside the warped logo) in
frames/capture/<shot>/.
"""

import argparse
import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np
import SimpleITK as sitk
from scipy.interpolate import BSpline, PchipInterpolator
from scipy.optimize import least_squares
from scipy.sparse import lil_matrix

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
        # the frames to fit: the collapse is keyframed (from 1.13 s the registration pins the
        # tile's corner highlights rather than the receding smears, and its 67 px mesh smears them
        # wider than the film's, so they'd vanish in a jump); the fitted values' B-spline knots
        # (s apart), and how strongly their curvature is penalised
        "fit": (0.208, 1.01),
        "knots": 0.125,
        "smooth": 1.0,
        "seed": 0.6,
        "seedScale": 0.8,
        # the dome as in src/scene.ts: its centre (world units), its footprint's exponent over reel
        # time (a circle turning into a squircle), its rim's falloff, and the shot's lensHeight
        # (fitted heights are stored before it); its radius over reel time, measured off the film's
        # bright rim line (half its width, at zoom 1)
        "lens": {
            "center": (-0.01, 0.0),
            "exponent": [(0.28, 2.0), (0.33, 3.5), (0.38, 4.7), (0.45, 5.0)],
            "flat": 16.0,
            "edge": 0.3,
            "heightScale": 1.8,
            "radius": [(0.209, 0.415), (0.25, 0.44), (0.334, 0.455), (0.375, 0.472), (0.417, 0.478), (0.5, 0.489), (0.584, 0.507), (0.667, 0.518), (0.751, 0.526), (0.834, 0.531), (1.001, 0.535), (1.168, 0.54)],
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
        # after 2.84 s its echoes fade and the dome collapses (keyframed)
        "fit": (2.04, 2.84),
        "knots": 0.15,
        "smooth": 1.0,
        "seed": 2.2,
        "seedScale": 1.0,
        # a round dome whose radius and falloff are fitted too; one line of letters barely pins
        # its height on the frame, so it stays centred there
        "lens": {"center": (0.0, 0.0), "exponent": [(0.0, 2.0)], "flat": None, "edge": None, "heightScale": 1.3, "radius": None, "pinned": {"shiftY": 0.0}},
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


def keyed(keys: list[tuple[float, float]], t: float) -> float:
    """keys interpolated smoothly and without overshoot (monotone cubic), held beyond the ends"""
    if len(keys) == 1:
        return float(keys[0][1])
    ts = [k[0] for k in keys]
    return float(PchipInterpolator(ts, [k[1] for k in keys])(min(max(t, ts[0]), ts[-1])))


def lens_z(x: np.ndarray, y: np.ndarray, v: dict, center: tuple[float, float]) -> np.ndarray:
    """the dome's height, as lensZ in src/shaders.ts (without its ring)"""
    dx = (x - center[0] - v["shiftX"]) / v["radius"]
    dy = (y - center[1] - v["shiftY"]) / v["radius"]
    e = v["exponent"]
    rho = (np.abs(dx) ** e + np.abs(dy) ** e + 1e-12) ** (1 / e)
    r2 = dx * dx + dy * dy
    crown = np.maximum(0, 1 - v["crown"] * r2 - v.get("shoulder", 0.0) * r2 * r2)
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


FREE = {"radius": (0.1, 0.9, 0.05), "height": (0.0, 0.8, 0.05), "crown": (0.0, 1.0, 0.2), "shoulder": (0.0, 1.0, 0.2), "flat": (2.0, 20.0, 2.0), "edge": (0.2, 3.0, 0.2), "shiftX": (-0.08, 0.08, 0.02), "shiftY": (-0.08, 0.08, 0.02)}


def splines(times: np.ndarray, spacing: float) -> np.ndarray:
    """the cubic B-spline basis over the frames' times, knots `spacing` s apart (frames x coefficients)"""
    t0, t1 = float(times[0]), float(times[-1])
    pieces = max(1, round((t1 - t0) / spacing))
    knots = np.r_[[t0] * 3, np.linspace(t0, t1, pieces + 1), [t1] * 3]
    return BSpline.design_matrix(times, knots, 3).toarray()


def fit(name: str, shot: dict) -> None:
    """the dome over the shot's fitted frames, as smooth trajectories, fitted to the saved registration"""
    reg = np.load(ROOT / "analysis" / "out" / "capture" / f"{name}.npz")
    lens = shot["lens"]
    center = lens["center"]
    chosen = [k for k, t in enumerate(reg["times"]) if shot["fit"][0] <= t <= shot["fit"][1]]
    times = reg["times"][chosen]
    off, weights = reg["offsets"][chosen], reg["weights"][chosen]
    x, y, cw, ch = shot["crop"]
    grid = off.shape[1]
    X, Y = np.meshgrid(
        (x - 960) / PX_PER_UNIT + (np.arange(grid) + 0.5) / grid * cw / PX_PER_UNIT,
        -(y + ch - 540) / PX_PER_UNIT + (np.arange(grid) + 0.5) / grid * ch / PX_PER_UNIT,
    )
    B = splines(times, shot["knots"])
    # what isn't fitted: the morph's exponent and the measured footprint (smooth through their
    # keys), and the shot's fixed values
    known = [
        {
            **lens.get("pinned", {}),
            **{k: lens[k] for k in ("flat", "edge") if lens[k] is not None},
            **{k: keyed(lens[k], t) for k in ("exponent", "radius") if lens[k] is not None},
        }
        for t in times
    ]
    keys = [k for k in FREE if k not in known[0]]
    lo, hi, scale = (np.array([FREE[k][i] for k in keys]) for i in range(3))

    # 1. each frame alone, to seed the joint fit and drop the points that no dome explains
    points, seeds, previous = [], [], None
    for f, t in enumerate(times):
        w = weights[f]
        m = w > 0.02
        if "radius" in known[f]:
            # only inside the measured footprint
            e = known[f]["exponent"]
            m &= (np.abs(X - center[0]) ** e + np.abs(Y - center[1]) ** e) ** (1 / e) < 0.97 * known[f]["radius"]
        px, py, ox, oy, sw = X[m], Y[m], off[f][..., 0][m], off[f][..., 1][m], np.sqrt(w[m])

        def residual(u: np.ndarray) -> np.ndarray:
            qx, qy = refracted(px, py, {**known[f], **dict(zip(keys, u))}, center)
            return np.concatenate([sw * (qx - ox), sw * (qy - oy)])

        starts = [previous] if previous is not None else []
        starts.append(np.array([{"radius": 0.5, "height": 0.15, "crown": 0.5, "shoulder": 0.2, "flat": 6.0, "edge": 0.5}.get(k, 0.0) for k in keys]))
        best = min((least_squares(residual, np.clip(s0, lo, hi), bounds=(lo, hi), loss="soft_l1", f_scale=0.02, x_scale=scale) for s0 in starts), key=lambda r: r.cost)
        previous = best.x
        seeds.append(best.x)
        miss = np.hypot(*(best.fun / np.concatenate([sw, sw])).reshape(2, -1))
        # off by more than 30 px after its own fit: the registration's, not the oil's (a smear the
        # dome explains roughly still counts)
        keep = miss < max(4 * np.median(miss), 0.055)
        # at most 3000 points a frame, the same ones on every run
        index = np.flatnonzero(keep)
        if len(index) > 3000:
            index = np.sort(np.random.default_rng(f).choice(index, 3000, replace=False))
        points.append((px[index], py[index], ox[index], oy[index], sw[index]))

    # 2. all frames together: coefficients per key, the curvature of each trajectory penalised
    n, nk = B.shape[1], len(keys)
    coef0 = np.clip(np.linalg.lstsq(B, np.array(seeds), rcond=None)[0], lo, hi)
    weight = math.sqrt(shot["smooth"])

    def residuals(u: np.ndarray) -> np.ndarray:
        coef = u.reshape(n, nk)
        values = B @ coef
        out = []
        for f, (px, py, ox, oy, sw) in enumerate(points):
            qx, qy = refracted(px, py, {**known[f], **dict(zip(keys, values[f]))}, center)
            out += [sw * (qx - ox), sw * (qy - oy)]
        out.append((weight * (coef[2:] - 2 * coef[1:-1] + coef[:-2]) / scale).ravel())
        return np.concatenate(out)

    rows = sum(2 * len(p[0]) for p in points)
    sparsity = lil_matrix((rows + (n - 2) * nk, n * nk), dtype=int)
    row = 0
    for f, p in enumerate(points):
        cols = [j * nk + q for j in np.flatnonzero(B[f]) for q in range(nk)]
        for r in range(row, row + 2 * len(p[0])):
            sparsity[r, cols] = 1
        row += 2 * len(p[0])
    for j in range(n - 2):
        for q in range(nk):
            sparsity[row + j * nk + q, [(j + d) * nk + q for d in range(3)]] = 1
    joint = least_squares(residuals, coef0.ravel(), bounds=(np.tile(lo, n), np.tile(hi, n)), x_scale=np.tile(scale, n), jac_sparsity=sparsity, tr_solver="lsmr")
    values = B @ joint.x.reshape(n, nk)

    frames = []
    for f, t in enumerate(times):
        px, py, ox, oy, sw = points[f]
        v = {**known[f], **dict(zip(keys, values[f]))}
        qx, qy = refracted(px, py, v, center)
        miss = float(np.sqrt(np.sum(sw**2 * ((qx - ox) ** 2 + (qy - oy) ** 2)) / np.sum(sw**2) / 2))
        rest = float(np.sqrt(np.sum(sw**2 * (ox**2 + oy**2)) / np.sum(sw**2) / 2))
        print(f"{t:.3f}s  {rest:.3f} -> {miss:.3f}  " + " ".join(f"{k}={value:.3f}" for k, value in v.items()), flush=True)
        stored = {**v, "height": v["height"] / lens["heightScale"]}
        frames.append({"t": round(float(t), 3), "lens": {k: round(float(value), 5) for k, value in stored.items()}, "score": round(miss, 5)})
    out = ROOT / "data" / "fit"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{name}.json").write_text(json.dumps({"shot": name, "start": shot["start"], "frames": frames}, indent=2) + "\n")
    print(f"wrote data/fit/{name}.json ({len(frames)} frames)")


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
