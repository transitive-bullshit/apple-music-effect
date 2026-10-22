// The film: shots (one logo each, with its glass cover and rig motion) and every parameter of the
// oil, the optics and the camera. World units: the frame is 2 units tall at zoom 1, centred on 0,
// y up.

import type { Key, Wobble } from './driver'
import type { FootprintKind } from './assets'

export interface Params {
  // oil (shallow-water simulation)
  /** wave speed in the open oil, units/s */
  waveSpeed: number
  /** linear damping of the flow, 1/s */
  damping: number
  /** viscous diffusion of the flow, units²/s: smooths short waves the way thick oil does */
  viscosity: number
  /** drag on thin films (3 nu / h²), units²/s: how slowly oil drains off the cover */
  filmViscosity: number
  /** the depth below which a film's drag stops growing, units */
  hMin: number
  /** oil thinner than this over the cover reads as dry glass, units */
  film: number
  /** capillary (surface tension) coefficient: short ripples run ahead of long waves */
  tension: number
  /** an extra push of oil at the rig's rod, on top of the cover's own motion */
  sourceCenter: number
  /** radius of the rod's push, units */
  sourceRadius: number
  /** the dome's profile, H (1 - rho²)^lensEdge: 0.5 is a sphere-like cap, 1 a paraboloid */
  lensEdge: number
  /** multiplies the dome's keyframed height */
  lensHeight: number
  /** width of the crest that travels on the dome's edge, units */
  ringWidth: number
  /** wavelength of the wave train on the dome's edge, units (0: a single crest) */
  ringWavelength: number
  /** wavelength of the rod's ripples, units */
  rippleWavelength: number
  /** speed of the rod's ripples, units/s */
  rippleSpeed: number
  /** how far out the ripples reach, as a fraction of the dome's radius */
  rippleReach: number
  /** once the dome has taken the footprint's shape: the round crown's share of its profile */
  lensCrown: number
  /** once the dome has taken the footprint's shape: how flat its interior is (2: not at all) */
  lensFlat: number
  /** how much of the dome's volume joins the oil as it falls */
  lensRelease: number
  /** 1: a rising cover pushes the oil above it aside; 0: it carries it up */
  displace: number

  // glass cover
  /** the cover is drawn when its top breaks the surface; 0 hides it */
  coverOn: number
  /** dome height of the cover's top above its shoulder, units */
  crown: number
  /** height of the bevel at the cover's edge, units */
  bevel: number
  /** width of the bevel, units */
  bevelWidth: number
  /** width of the meniscus where oil meets the emerged cover, units */
  meniscus: number

  // optics
  /** depth of the logo below the oil's rest level, units */
  depth: number
  iorOil: number
  iorGlass: number
  /** multiplies the oil's dispersion (Cauchy B); 1 is mineral oil */
  dispersion: number
  /** the slope at which dispersion is half as strong (0: the same everywhere, as in real oil) */
  dispersionKnee: number
  /** the steepest the surface gets, where oil meets glass (0: no limit) */
  maxSlope: number
  /** wavelength samples per pixel per subframe */
  wavelengths: number
  /** blur where the surface curves (defocus), relative */
  defocus: number
  /** constant blur of the logo, in mip levels */
  blur: number
  /** strength of the surface's reflection of the studio */
  reflect: number
  /** 1: the logo shows only within the dome's footprint (as in Apple's film) */
  reveal: number
  /** softness of the reveal's edge, as a fraction of the dome's radius */
  revealSoft: number
  /** brightness of the studio's softboxes in reflections */
  softbox: number
  /** brightness of the studio's walls, which steep rims catch at grazing angles */
  horizon: number

  // look
  exposure: number
  logoColor: readonly [number, number, number]
  floorColor: readonly [number, number, number]
  bloom: number
  bloomRadius: number
  grain: number
  vignette: number

  // camera
  /** shutter as a fraction of the frame interval (0.5 is a 180° shutter) */
  shutter: number
  /** subframes accumulated per output frame, for motion blur and smoother spectra */
  subframes: number
}

export const DEFAULT_PARAMS: Params = {
  waveSpeed: 2,
  damping: 0.4,
  viscosity: 0.001,
  filmViscosity: 0.00002,
  hMin: 0.0015,
  film: 0.004,
  tension: 0,
  sourceCenter: 0,
  sourceRadius: 0.2,
  lensEdge: 0.6,
  lensHeight: 1,
  ringWidth: 0.05,
  ringWavelength: 0,
  rippleWavelength: 0.055,
  rippleSpeed: 0.4,
  rippleReach: 0.9,
  lensCrown: 0,
  lensFlat: 2,
  lensRelease: 0.15,
  displace: 1,

  coverOn: 1,
  crown: 0.03,
  bevel: 0.02,
  bevelWidth: 0.05,
  meniscus: 0.006,

  depth: 1,
  iorOil: 1.47,
  iorGlass: 1.49,
  dispersion: 16,
  dispersionKnee: 0,
  maxSlope: 0,
  wavelengths: 24,
  defocus: 0.05,
  blur: 0,
  reflect: 1,
  reveal: 1,
  revealSoft: 0.06,
  softbox: 20,
  horizon: 6,

  exposure: 1,
  logoColor: [0.93, 0.95, 1],
  floorColor: [0.0012, 0.0014, 0.002],
  bloom: 0.03,
  bloomRadius: 1,
  // the film has none: its held frames are perfectly still
  grain: 0,
  vignette: 0.25,

  shutter: 0.5,
  subframes: 4
}

export interface LogoSpec {
  /** URL of an SVG or bitmap */
  src: string
  /** alpha for transparent logos; luminance (light on dark) or inverse (dark on light) for opaque ones */
  mode: 'alpha' | 'luminance' | 'inverse'
  /** centre of the image, world units */
  center: readonly [number, number]
  /** width of the whole image (its viewBox for an SVG), world units */
  width: number
}

export interface CoverSpec {
  footprint: FootprintKind
  center: readonly [number, number]
  /** footprint width and height, world units */
  size: readonly [number, number]
}

/** every number that shapes the dome at a moment (see lensZ in src/shaders.ts) */
export interface LensState {
  /** footprint radius (half-size), units */
  radius: number
  /** height of the crown, units */
  height: number
  /** superellipse exponent of the footprint: 2 is a circle */
  exponent: number
  /** the round crown's share of the profile */
  crown: number
  /** a round quartic term after the crown: the dome steepens toward its rim */
  shoulder: number
  /** interior flatness of the edge falloff (2: not flat) */
  flat: number
  /** power of the edge falloff: below 1 is steep at the rim */
  edge: number
  /** offset of the dome's centre from the rig, units */
  shiftX: number
  shiftY: number
  /** a prism across the dome: height gained per radius in x and y, relative to the crown */
  tiltX: number
  tiltY: number
  /** astigmatism: (x² - y²) and xy terms, relative to the crown */
  astig: number
  skew: number
  /** the wave on the dome's edge: height, width and wavelength (0: a single crest), units */
  ring: number
  ringWidth: number
  ringWave: number
  /** height of the rod's ripples, units */
  ripple: number
}

export type LensKey = keyof LensState

/** the rig's dome of oil: footprint radius, height and shape over shot time */
export interface LensSpec {
  center: readonly [number, number]
  /** superellipse exponent the footprint morphs to (2 stays a circle; 5 is the icon's shape) */
  exponent: number
  radius: readonly Key[]
  height: readonly Key[]
  /** 0: a circle, 1: the full exponent */
  morph: readonly Key[]
  /** height of the crest that travels on the dome's edge once it falls (optional) */
  ring?: readonly Key[]
  /** height of the rod's ripples on the dome (optional) */
  ripple?: readonly Key[]
  /**
   * keyframes for any other value, replacing what the morph derives; a fit to the film (data/fit,
   * src/fits.ts) replaces these, radius and height over its time range
   */
  keys?: Partial<Record<LensKey, readonly Key[]>>
}

export interface Shot {
  name: string
  /** film time the shot starts and ends; the oil starts at rest at `start` */
  start: number
  end: number
  logo: LogoSpec
  cover: CoverSpec | null
  /** the rig's chrome tip: radius, and its centre's height above the dome's crown over shot time */
  ball: { radius: number; lift: readonly Key[] } | null
  /** the cover's height over shot time: [s, units relative to the oil's rest level] */
  rig: readonly Key[]
  /** the volume the rod pushes into the oil over shot time (relative; scaled by sourceCenter) */
  push: readonly Key[]
  /** the rod's oscillation at the note's frequency, added to the push: it launches ring ripples */
  pushWobble: Wobble | null
  lens: LensSpec | null
  wobble: Wobble | null
  /** the rig rocking: the cover top's slope in x and in y over shot time */
  tilt: readonly [readonly Key[], readonly Key[]]
  /** brightness over shot time (the film fades each mark in) */
  fade: readonly Key[]
  /** how strongly the oil splits colour over shot time, times the shot's dispersion (1 if absent) */
  colour?: readonly Key[]
  /** camera zoom over shot time */
  zoom: readonly Key[]
  params: Partial<Params>
}

export interface Film {
  name: string
  duration: number
  fps: number
  /** frame width / height */
  aspect: number
  shots: Shot[]
}

export function shotAt(film: Film, t: number) {
  return film.shots.find((s) => t >= s.start && t < s.end) ?? film.shots.at(-1)!
}

export function paramsFor(shot: Shot): Params {
  return { ...DEFAULT_PARAMS, ...shot.params }
}

// The Apple Music sting, matched to the reel (reel time; the YouTube cut is reel + 69.334 s).
// Placements are measured off the film's 1080p frames (1 unit = 540 px). Logos are local
// reference assets (reference/brand, not in git).

export const APPLE_MUSIC: Film = {
  name: 'apple-music',
  duration: 4,
  fps: 24000 / 1001,
  aspect: 16 / 9,
  shots: [
    {
      name: 'icon',
      start: 0,
      end: 1.465,
      // the new note, traced from the settled frame at 1.24 s (camera zoom 0.973 there)
      logo: {
        src: 'reference/brand/traced/note-yt.svg',
        mode: 'alpha',
        center: [-0.0143, -0.0038],
        width: 263 / 540 / 0.973
      },
      cover: { footprint: 'squircle', center: [-0.01, 0], size: [1.24, 1.24] },
      ball: null,
      pushWobble: null,
      // the glass tile: under the oil until the dome has spread over it, then its rim stands
      // just proud of the surface, where the oil all but hides it: only its edge catches light
      rig: [
        [0, -0.05],
        [0.35, -0.05],
        [0.5, -0.015]
      ],
      tilt: [[[0, 0]], [[0, 0]]],
      // the film's first bubble brightens over its first six frames
      fade: [
        [0.04, 0],
        [0.25, 1]
      ],
      // the small early dome's rim carries only thin colour in the film
      colour: [
        [0.1, 0.3],
        [0.21, 1]
      ],
      push: [[0, 0]],
      lens: {
        center: [-0.01, 0],
        exponent: 5,
        // half the width of the film's bright rim line (analysis/capture.py fits the dome inside it)
        radius: [
          [0.05, 0.1],
          [0.08, 0.17],
          [0.1, 0.21],
          [0.12, 0.29],
          [0.14, 0.33],
          [0.17, 0.37],
          [0.21, 0.415],
          [0.25, 0.44],
          [0.33, 0.455],
          [0.42, 0.478],
          [0.58, 0.507],
          [0.75, 0.526],
          [1, 0.535],
          [1.17, 0.54]
        ],
        // the fit (data/fit/icon.json) covers 0.21-1 s; before it the small dome rises into the
        // fit's first height (0.063), magnifying strongly while its footprint is small; after it it falls over six frames, as the film's smears recede, to
        // a thin layer of oil whose rim still outlines the tile. The keys between are the
        // earlier hand fit, from the gap between the note's stems, used only without the fit.
        height: [
          [0.05, 0],
          [0.08, 0.035],
          [0.12, 0.055],
          [0.17, 0.064],
          [0.25, 0.17],
          [0.33, 0.125],
          [0.42, 0.12],
          [0.5, 0.117],
          [0.6, 0.109],
          [0.8, 0.1],
          [0.9, 0.091],
          [1, 0.081],
          [1.08, 0.075],
          [1.17, 0.04],
          [1.25, 0.012]
        ],
        morph: [
          [0.28, 0],
          [0.33, 0.5],
          [0.38, 0.9],
          [0.45, 1]
        ]
      },
      wobble: null,
      // the camera pulls back from 1.2 s, accelerating into the cut (measured off the note's size)
      zoom: [
        [1.2, 1],
        [1.24, 0.973],
        [1.273, 0.926],
        [1.307, 0.87],
        [1.34, 0.814],
        [1.373, 0.743],
        [1.407, 0.612],
        [1.44, 0.426],
        [1.465, 0.3]
      ],
      // the dome before the fit takes over (data/fit/icon.json, from 0.21 s): a round crown on a flat
      // interior with a steep rim. Colour gathers on the steep rim, as in the film, where the
      // smears of the note's flag and head carry it while the magnified interior stays clean; the
      // studio's key light barely shows in the film's oil
      params: {
        crown: 0,
        bevel: 0.02,
        bevelWidth: 0.05,
        lensRelease: 0,
        lensCrown: 0.5,
        lensFlat: 4,
        lensEdge: 0.3,
        lensHeight: 1.8,
        dispersion: 100,
        dispersionKnee: 0.9,
        maxSlope: 1.4,
        softbox: 4
      }
    },
    {
      name: 'wordmark',
      start: 1.465,
      end: 4,
      logo: {
        src: 'reference/brand/traced/wordmark-yt.svg',
        mode: 'alpha',
        center: [(960 - 960) / 540, -(534.5 - 540) / 540],
        width: 588 / 540
      },
      cover: null,
      // the rig's chrome tip stands in the dome's crown, then sinks out of sight
      ball: {
        radius: 0.065,
        lift: [
          [0, 0],
          [0.25, -0.01],
          [0.4, -0.2]
        ]
      },
      rig: [[0, 0]],
      push: [[0, 0]],
      // ripples at about 30 Hz in picture time: the rings inside the orb
      pushWobble: { start: 0, freq: 30, amp: 1, decay: 0.35, attack: 0.02 },
      tilt: [[[0, 0]], [[0, 0]]],
      fade: [
        [0, 0.3],
        [0.035, 1]
      ],
      // the orb's rings are nearly white in the film; the smeared ends carry strong colour
      colour: [
        [0.45, 0.2],
        [0.6, 1]
      ],
      lens: {
        center: [0, 0],
        exponent: 2,
        // shot time = reel time - 1.465
        // from 0.575 (2.04 s) the fit (data/fit/wordmark.json) takes over: a wide, low dome whose
        // soft rim lies on the wordmark's ends; after it, the keys carry on from its size
        radius: [
          [0, 0.15],
          [0.035, 0.17],
          [0.085, 0.2],
          [0.135, 0.24],
          [0.215, 0.3],
          [0.295, 0.35],
          [0.375, 0.4],
          [0.455, 0.47],
          [0.535, 0.6],
          [0.635, 0.6],
          [0.735, 0.69],
          [0.885, 0.71],
          [1.035, 0.73],
          [1.185, 0.76],
          [1.335, 0.765],
          [1.5, 0.77],
          [1.7, 0.8]
        ],
        // the orb's dome, which from 0.375 (1.84 s) widens and falls into the fit's wide, low one
        // (0.035 at 0.58), which collapses from 1.375 (2.84 s) by 1.62 (3.08 s), as the film's
        // echoes fade
        height: [
          [0, 0.015],
          [0.035, 0.02],
          [0.135, 0.045],
          [0.295, 0.075],
          [0.375, 0.095],
          [0.635, 0.06],
          [0.735, 0.02],
          [0.85, 0],
          [1.62, 0]
        ],
        morph: [[0, 0]],
        // the orb's profile, which turns into the fit's (data/fit/wordmark.json, from 0.58) over the
        // film's quarter second of widening
        keys: {
          flat: [
            [0, 2],
            [0.375, 2]
          ],
          edge: [
            [0, 0.8],
            [0.375, 0.8]
          ]
        },
        ring: [
          [0.5, 0],
          [0.7, 0.008],
          [1.1, 0.006],
          [1.45, 0.0035],
          [1.8, 0]
        ],
        ripple: [
          [0, 0.0018],
          [0.3, 0.0012],
          [0.5, 0]
        ]
      },
      wobble: null,
      zoom: [[0, 1]],
      params: {
        sourceCenter: 0.02,
        sourceRadius: 0.05,
        // the fitted dome stands until it collapses at 2.92 s: releasing its oil earlier sends
        // a wave through the letters
        lensRelease: 0,
        lensEdge: 0.8,
        lensHeight: 1.3,
        ringWavelength: 0.06,
        ringWidth: 0.06,
        horizon: 2.5,
        rippleWavelength: 0.08,
        // the film's dome barely reflects; its colour is in the smeared ends
        reflect: 0.1,
        dispersion: 100,
        dispersionKnee: 0.3
      }
    }
  ]
}
