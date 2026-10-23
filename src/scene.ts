// The film: two shots, each a logo under one dome of oil, and every parameter of the optics and
// the camera. World units: the frame is 2 units tall at zoom 1, centred on 0, y up.
//
// Everything that moves is a smooth curve over shot time with a few keys: per shot the dome's four
// (src/dome.ts, fitted to the film), its brightness, colour and the camera's zoom, and for the
// wordmark the wave on the dome's edge and the rig's chrome tip.

import iconDome from '../data/dome/icon.json'
import wordmarkDome from '../data/dome/wordmark.json'
import { type DomeSpec, parseDome } from './dome'
import type { Key } from './driver'

export interface Params {
  // the dome
  /** multiplies the dome's height (the panel's Dome dial) */
  dome: number
  /** width of the crest that travels on the dome's edge, units */
  ringWidth: number
  /** wavelength of the wave train on the dome's edge, units (0: a single crest) */
  ringWavelength: number
  /** how far outside the dome's rim the wave on its edge runs, units */
  ringOffset: number
  /** how fast the wave train's crests travel outward, units/s (negative: inward) */
  ringSpeed: number
  /** wavelength of the rod's ripples, units */
  rippleWavelength: number
  /** speed of the rod's ripples, units/s */
  rippleSpeed: number
  /** how far out the ripples reach, as a fraction of the dome's radius */
  rippleReach: number

  // optics
  /** depth of the logo below the oil's rest level, units */
  depth: number
  iorOil: number
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
  /** brightness of a ring light around the lens, which slopes of about 0.35 catch whichever way they face */
  ringLight: number
  /** how far the ring light spreads off that angle: wider is a softer reflection */
  ringLightWidth: number

  // look
  exposure: number
  logoColor: readonly [number, number, number]
  floorColor: readonly [number, number, number]
  bloom: number
  bloomRadius: number
  grain: number
  vignette: number
  /** the grade's saturation: 1 leaves colour as rendered */
  saturation: number
  /** the display level crushed to black, 0..1 */
  black: number
  /** the glow's colour (the bloom's tint) */
  glowTint: readonly [number, number, number]
  /** white balance: a gain per channel */
  balance: readonly [number, number, number]

  // camera
  /** shutter as a fraction of the frame interval (0.5 is a 180° shutter) */
  shutter: number
  /** subframes accumulated per output frame: motion blur, and more wavelength samples */
  subframes: number
}

export const DEFAULT_PARAMS: Params = {
  dome: 1,
  ringWidth: 0.05,
  ringWavelength: 0,
  ringOffset: 0,
  ringSpeed: 0,
  rippleWavelength: 0.055,
  rippleSpeed: 0.4,
  rippleReach: 0.9,

  depth: 1,
  iorOil: 1.47,
  dispersion: 16,
  dispersionKnee: 0,
  maxSlope: 0,
  wavelengths: 12,
  defocus: 0.05,
  blur: 0,
  reflect: 1,
  reveal: 1,
  revealSoft: 0.06,
  softbox: 20,
  horizon: 6,
  ringLight: 0,
  ringLightWidth: 0.45,

  exposure: 1,
  logoColor: [0.93, 0.95, 1],
  floorColor: [0.0012, 0.0014, 0.002],
  bloom: 0.03,
  bloomRadius: 1,
  // the film has none: its held frames are perfectly still
  grain: 0,
  vignette: 0.25,
  // the film's grade: richer colour than the oil gives on its own, and crushed blacks
  saturation: 1.5,
  black: 0.012,
  // the film's glows and soft edges are blue, its whites slightly cool
  glowTint: [0.55, 0.75, 1.35],
  balance: [0.97, 1, 1.03],

  shutter: 0.5,
  // enough that fast smears blur rather than stutter
  subframes: 8
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

export interface Shot {
  name: string
  /** film time the shot starts and ends */
  start: number
  end: number
  logo: LogoSpec
  dome: DomeSpec
  /** the wave train on the dome's edge: its height over shot time (none if absent) */
  ring?: readonly Key[]
  /** how far outside the dome's rim that wave runs over shot time, units (params.ringOffset if absent) */
  ringReach?: readonly Key[]
  /** the rod's ripples: their height at the shot's start (units), decaying with a time constant (s),
   * and gone once the dome has settled */
  ripple?: { height: number; decay: number }
  /** the rig's chrome tip: radius, and its centre's height above the dome's crown over shot time */
  ball: { radius: number; lift: readonly Key[] } | null
  /** brightness over shot time (the film fades each mark in) */
  fade: readonly Key[]
  /** how strongly the oil splits colour over shot time, times the shot's dispersion (1 if absent) */
  colour?: readonly Key[]
  /** how strongly the dome reflects the studio over shot time, times the shot's reflect (1 if absent) */
  gloss?: readonly Key[]
  /** camera zoom over shot time */
  zoom: readonly Key[]
  /** the logo's size over shot time as it recedes from the camera, about its centre (1 if absent) */
  recede?: readonly Key[]
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
// Placements are measured off the film's 1080p frames (1 unit = 540 px). The logos are our traces
// of the film's note and wordmark (public/apple).

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
        src: 'apple/note.svg',
        mode: 'alpha',
        center: [-0.0143, -0.0038],
        width: 263 / 540 / 0.973
      },
      // a bubble that grows into the icon's rounded square, magnifying the note, then settles
      // into a flat top with a steep rim that smears the note's flag and head into the corners,
      // and falls to a thin layer whose rim outlines the tile
      dome: parseDome(iconDome),
      ball: null,
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
      // a ripple runs just ahead of the bubble's rim while it grows; then a wave of displaced oil
      // leaves the tile's edge (0.55-1 s), travelling outward at about 0.5 units/s and fading,
      // its flanks catching the side lights (measured off the film's outer lines)
      ring: [
        [0.1, 0],
        [0.2, 0.012],
        [0.3, 0.008],
        [0.42, 0],
        [0.5, 0],
        [0.62, 0.012],
        [0.85, 0.008],
        [1.0, 0]
      ],
      ringReach: [
        [0.1, 0.05],
        [0.42, 0.05],
        [0.55, 0.03],
        [0.63, 0.07],
        [0.8, 0.16],
        [1.0, 0.26]
      ],
      // the camera holds; from 1.2 s the note recedes into the dark, accelerating into the cut,
      // while the tile's outline keeps its size and fades (measured off the note's size)
      zoom: [[0, 1]],
      recede: [
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
      // colour gathers on the steep rim, as in the film, where the smears of the note's flag and head
      // carry it while the magnified interior stays clean; the studio's key light barely shows in
      // the film's oil
      params: {
        dispersion: 100,
        dispersionKnee: 0.9,
        maxSlope: 1.4,
        softbox: 4,
        ringWidth: 0.02,
        // the fitted dome a little lower: the registration over-reads the smears' width, and 0.9
        // brings the lit area, colour and sharpness closest to the film's (by the scorecard)
        dome: 0.9
      }
    },
    {
      name: 'wordmark',
      start: 1.465,
      end: 4,
      logo: {
        src: 'apple/wordmark.svg',
        mode: 'alpha',
        center: [(960 - 960) / 540, -(534.5 - 540) / 540],
        width: 588 / 540
      },
      // an orb around the rig's chrome tip that widens and settles into a wide, low dome whose
      // soft rim lies on the wordmark's ends, smearing them outward, then falls flat
      dome: parseDome(wordmarkDome),
      // the echoes on the dome's edge (shot time = reel time - 1.465), from about 2.3 s as in the
      // film: gentle while the wide dome stands, so they bend only the wordmark's ends; then, as it
      // flattens and its edge pulls in, the copies of the ends that drift and fade by 3.08 s
      ring: [
        [0.7, 0],
        [0.9, 0.003],
        [1.0, 0.003],
        [1.2, 0.0035],
        [1.45, 0.0025],
        [1.62, 0]
      ],
      // the orb's rings, strongest as it appears
      ripple: { height: 0.005, decay: 0.5 },
      // the rig's chrome tip stands in the orb's crown, then sinks out of sight as it widens
      ball: {
        radius: 0.065,
        lift: [
          [0.25, 0],
          [0.4, -0.2]
        ]
      },
      fade: [
        [0, 0.3],
        [0.035, 1]
      ],
      // the orb's rings are nearly white in the film; the smeared ends carry strong colour
      colour: [
        [0.375, 0.2],
        [0.58, 1]
      ],
      // the orb's ripples and round outline reflect the studio, fading from 1.7 s and nearly gone by
      // 1.9 s, as the film's round light does (measured off the band, frame by frame), leaving the
      // ripple only where it bends the wordmark's ends
      gloss: [
        [0.25, 1],
        [0.42, 0.1],
        [0.6, 0]
      ],
      zoom: [[0, 1]],
      params: {
        // the film's wordmark barely glows
        bloom: 0.012,
        ringWavelength: 0.06,
        ringWidth: 0.06,
        // the wave travels outward, so the echo bars keep moving as they fade
        ringSpeed: 0.08,
        // the film's key and walls barely show in this dome; a broad, soft ring light around the
        // lens draws the orb's ripples as rings all the way round, and its outline as a soft halo
        // (see gloss for how that fades)
        softbox: 2,
        horizon: 0.25,
        ringLight: 1.3,
        rippleWavelength: 0.08,
        dispersion: 60,
        dispersionKnee: 0.3
      }
    }
  ]
}
