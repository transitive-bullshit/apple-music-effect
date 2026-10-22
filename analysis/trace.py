"""Trace a still, light-on-dark logo from video frames into an SVG.

    uv run --group analysis python analysis/trace.py frames/yt/f_00151.png ... --out logo.svg

The per-pixel median of the frames removes compression noise; the median is upsampled before
thresholding at half the logo's brightness, and potrace fits Bezier curves to the result. Paths
come out in the frame's pixel coordinates, cropped to the logo's bounds plus a margin.
"""

import argparse
from pathlib import Path

import cv2
import numpy as np
import potrace


def median_frame(paths: list[Path]) -> np.ndarray:
    frames = [cv2.imread(str(p), cv2.IMREAD_GRAYSCALE).astype(np.float32) for p in paths]
    return np.median(np.stack(frames), axis=0)


def to_path(plist, scale: float, ox: float, oy: float) -> str:
    def pt(p) -> str:
        return f"{p.x / scale + ox:.2f},{p.y / scale + oy:.2f}"

    parts = []
    for curve in plist:
        parts.append(f"M{pt(curve.start_point)}")
        for seg in curve:
            if seg.is_corner:
                parts.append(f"L{pt(seg.c)}L{pt(seg.end_point)}")
            else:
                parts.append(f"C{pt(seg.c1)} {pt(seg.c2)} {pt(seg.end_point)}")
        parts.append("Z")
    return "".join(parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("frames", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--upscale", type=int, default=8)
    parser.add_argument("--margin", type=int, default=8)
    parser.add_argument("--roi", help="x,y,w,h: trace only this region of the frame")
    args = parser.parse_args()

    img = median_frame(args.frames)
    if args.roi:
        rx, ry, rw, rh = (int(v) for v in args.roi.split(","))
        keep = np.zeros_like(img, dtype=bool)
        keep[ry : ry + rh, rx : rx + rw] = True
        img = np.where(keep, img, np.median(img))
    bg = float(np.median(img))
    fg = float(np.percentile(img, 99.9))
    ys, xs = np.where(img > (bg + fg) / 2)
    x0, x1 = xs.min() - args.margin, xs.max() + args.margin
    y0, y1 = ys.min() - args.margin, ys.max() + args.margin
    crop = img[y0:y1, x0:x1]
    s = args.upscale
    big = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), s * 0.35)
    # potracer fills the cells that are False, so hand it the background
    plist = potrace.Bitmap(big <= (bg + fg) / 2).trace(
        turdsize=4 * s * s, alphamax=1.0, opticurve=True, opttolerance=0.2
    )
    d = to_path(plist, s, x0, y0)
    w, h = x1 - x0, y1 - y0
    args.out.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {y0} {w} {h}" width="{w}" height="{h}">'
        f'<path fill="#fff" fill-rule="evenodd" d="{d}"/></svg>\n'
    )
    print(f"wrote {args.out}: {len(plist)} curves, bounds {x0},{y0} {w}x{h} px")


if __name__ == "__main__":
    main()
