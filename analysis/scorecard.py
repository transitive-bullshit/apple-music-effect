"""How closely renders follow Apple's film, as curves over time rather than frame by frame.

    uv run --group analysis python analysis/scorecard.py renders/final/apple-music-sting-1080p.mp4
    uv run --group analysis python analysis/scorecard.py before=a.mp4 now=b.mp4 --chart renders/scorecard.png

Per frame it measures a few statistics of the look, for the film and each render: how much of the
frame is lit (magnification and smears), how colourful the bright parts are and whether warm or
cool, how much light falls off the wordmark's band (how round its ripple is), the black level, edge
sharpness, and how much the frame changes from the last. Each curve is smoothed over about a fifth
of a second, so a render scores by following the film's trends, not by matching single frames, and
compared per shot. Lower is closer; each error is relative to how much the film's curve varies.

Needs the reference film (reference/youtube, not in git).
"""

import argparse
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FPS = 24000 / 1001
OFFSET = 69.334
FILM = ROOT / "reference" / "youtube" / "apple-music-identity.mkv"
W, H = 960, 540
SHOTS = {"icon": (0.0, 1.465), "wordmark": (1.465, 4.0)}
SMOOTH = 5  # frames
# the least each metric's error is measured against: a black level within 2 of 255 is a match
FLOOR = {"black": 2.0}


def frames(src: Path, film: bool, duration: float = 4.0) -> np.ndarray:
    """every frame at W x H, linear RGB in 0..1"""
    args = ["ffmpeg", "-loglevel", "error"]
    if film:
        args += ["-ss", str(OFFSET), "-t", str(duration), "-i", str(src), "-vf", f"fps=24000/1001,scale={W}:{H}"]
    else:
        args += ["-t", str(duration), "-i", str(src), "-vf", f"scale={W}:{H}"]
    args += ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    v = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32) / 255
    return v**2.2


Y, X = np.mgrid[0:H, 0:W]
R = np.hypot(X - W / 2, Y - H / 2 * 537 / 540)
OFF_BAND = (np.abs(Y - H / 2) > 45) & (R > 30) & (R < 210)
CORNERS = np.zeros((H, W), bool)
CORNERS[:60, :90] = CORNERS[:60, -90:] = CORNERS[-60:, :90] = CORNERS[-60:, -90:] = True


def stats(v: np.ndarray) -> dict[str, np.ndarray]:
    srgb = v ** (1 / 2.2)
    luma = srgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hi = srgb.max(axis=-1)
    chroma = hi - srgb.min(axis=-1)
    bright = hi > 0.3
    coloured = bright & (chroma > 0.2)
    warm = coloured & (srgb[..., 0] > srgb[..., 2])
    gy, gx = np.gradient(luma, axis=(1, 2))
    edge = np.hypot(gx, gy)
    lum_lin = v @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    n = len(v)
    out = {
        "lit": (luma > 0.5).reshape(n, -1).mean(axis=1),
        "colourful": np.array([chroma[i][bright[i]].mean() if bright[i].any() else 0 for i in range(n)]),
        "coloured": coloured.reshape(n, -1).mean(axis=1) * 100,
        "warm": np.array([warm[i].sum() / max(coloured[i].sum(), 1) for i in range(n)]),
        "off band": np.array([lum_lin[i][OFF_BAND].mean() for i in range(n)]) * 1000,
        "black": np.array([np.percentile(luma[i][CORNERS], 50) for i in range(n)]) * 255,
        "sharpness": np.array([edge[i][luma[i] > 0.15].mean() if (luma[i] > 0.15).any() else 0 for i in range(n)]),
        "motion": np.concatenate([[0], np.abs(np.diff(luma, axis=0)).reshape(n - 1, -1).mean(axis=1)]) * 1000,
    }
    return out


def smooth(c: np.ndarray) -> np.ndarray:
    k = np.ones(SMOOTH) / SMOOTH
    return np.convolve(np.pad(c, SMOOTH // 2, mode="edge"), k, mode="valid")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("renders", nargs="+", help="name=path.mp4, or a path")
    parser.add_argument("--chart", help="write the curves to this PNG")
    args = parser.parse_args()
    film = stats(frames(FILM, True))
    runs = {}
    for spec in args.renders:
        name, _, path = spec.rpartition("=")
        runs[name or Path(path).stem] = stats(frames(ROOT / path, False))
    n = min(len(film["lit"]), *(len(r["lit"]) for r in runs.values()))
    t = np.arange(n) / FPS
    metrics = list(film)
    print(f"{'':12}" + "".join(f"{name:>22}" for name in runs))
    totals = {name: 0.0 for name in runs}
    for shot, (a, b) in SHOTS.items():
        sel = (t >= a + 0.05) & (t < b - 0.02)
        print(f"{shot}")
        for m in metrics:
            if m == "off band" and shot == "icon":
                continue
            f = smooth(film[m][:n])[sel]
            scale = max(f.std(), 0.1 * abs(f.mean()), FLOOR.get(m, 1e-6))
            row = ""
            for name, r in runs.items():
                e = float(np.sqrt(np.mean((smooth(r[m][:n])[sel] - f) ** 2)) / scale)
                totals[name] += e
                row += f"{e:22.2f}"
            print(f"  {m:10}{row}")
    print(f"{'total':12}" + "".join(f"{totals[name]:22.2f}" for name in runs))

    if args.chart:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, axes = plt.subplots(len(metrics), 1, figsize=(11, 2.0 * len(metrics)), dpi=110, sharex=True)
        colours = ["#d9534f", "#2b7bd9", "#5cb85c", "#9b59b6"]
        for ax, m in zip(axes, metrics):
            ax.plot(t, smooth(film[m][:n]), color="#111", lw=2.2, label="Apple's film")
            for (name, r), c in zip(runs.items(), colours):
                ax.plot(t, smooth(r[m][:n]), color=c, lw=1.5, label=name)
            ax.axvline(1.465, color="#999", lw=0.8, ls="--")
            ax.set_ylabel(m)
            ax.spines[["top", "right"]].set_visible(False)
        axes[0].legend(frameon=False, fontsize=8, ncol=4)
        axes[-1].set_xlabel("reel time (s)")
        fig.tight_layout()
        fig.savefig(ROOT / args.chart)
        print(f"wrote {args.chart}")


if __name__ == "__main__":
    main()
