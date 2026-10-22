// The engine: per pixel, the view ray refracts through the oil's dome onto the logo, once per
// wavelength. A frame accumulates subframes across the shutter (motion blur), then bloom and the
// finish. The surface is closed-form in time (src/dome.ts), so there is nothing to step: any frame
// is a pure function of its time, rendered in any order.

import { imageAspect, loadImage, rasterize, toMask } from './assets'
import { type DomeState, domeAt } from './dome'
import { interpolate } from './driver'
import {
  clearTarget,
  createContext,
  createImageTexture,
  createPass,
  createTarget,
  deleteTarget,
  type Pass,
  type Target
} from './gl'
import {
  type Film,
  type LogoSpec,
  type Params,
  paramsFor,
  type Shot
} from './scene'
import { COPY, DOWNSAMPLE, FINISH, OPTICS, UPSAMPLE } from './shaders'

export interface EngineOptions {
  width: number
  height: number
  preserveDrawingBuffer?: boolean
}

interface ShotAssets {
  logo: WebGLTexture
  logoRect: [number, number, number, number]
  logoTexels: [number, number]
}

/** logo texels per world unit (the frame is 2 units tall) */
const LOGO_TEXELS_PER_UNIT = 1400
const BLOOM_LEVELS = 6

export class Engine {
  readonly gl: WebGL2RenderingContext
  film: Film
  /** the drawing size in pixels (resize() changes it) */
  width: number
  height: number

  private assets: ShotAssets[] = []
  private params: Params[]
  private readonly canvas: HTMLCanvasElement
  private color!: Target
  private accum!: Target
  private bloom: Target[] = []
  private bloomUp: Target[] = []
  private passes: Record<string, Pass>
  /** 0: the picture; 1: surface height, 2: slope, 4: ray offset, 5: its direction (scaled by debugScale) */
  debug = 0
  debugScale = 0.05

  private constructor(
    canvas: HTMLCanvasElement,
    film: Film,
    opts: EngineOptions
  ) {
    this.film = film
    this.canvas = canvas
    this.width = opts.width
    this.height = opts.height
    canvas.width = opts.width
    canvas.height = opts.height
    const gl = createContext(canvas, opts.preserveDrawingBuffer)
    this.gl = gl
    this.params = film.shots.map(paramsFor)
    this.allocate()
    this.passes = {
      optics: createPass(gl, OPTICS),
      copy: createPass(gl, COPY),
      down: createPass(gl, DOWNSAMPLE),
      up: createPass(gl, UPSAMPLE),
      finish: createPass(gl, FINISH)
    }
  }

  /** the frame-sized targets: the picture, the subframe accumulation, the bloom chain */
  private allocate() {
    const gl = this.gl
    this.color = createTarget(gl, this.width, this.height, {
      format: 'rgba32f'
    })
    this.accum = createTarget(gl, this.width, this.height, {
      format: 'rgba32f',
      filter: 'linear'
    })
    this.bloom = []
    this.bloomUp = []
    let w = this.width
    let h = this.height
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1)
      h = Math.max(1, h >> 1)
      this.bloom.push(
        createTarget(gl, w, h, { format: 'rgba16f', filter: 'linear' })
      )
      if (i < BLOOM_LEVELS - 1)
        this.bloomUp.push(
          createTarget(gl, w, h, { format: 'rgba16f', filter: 'linear' })
        )
    }
  }

  /** changes the drawing size: the canvas and every frame-sized target */
  resize(width: number, height: number) {
    width = Math.max(1, Math.round(width))
    height = Math.max(1, Math.round(height))
    if (width === this.width && height === this.height) return
    for (const t of [this.color, this.accum, ...this.bloom, ...this.bloomUp])
      deleteTarget(this.gl, t)
    this.width = width
    this.height = height
    this.canvas.width = width
    this.canvas.height = height
    this.allocate()
  }

  static async create(
    canvas: HTMLCanvasElement,
    film: Film,
    opts: EngineOptions
  ) {
    const engine = new Engine(canvas, film, opts)
    await engine.loadAssets()
    return engine
  }

  async loadAssets() {
    this.assets = await Promise.all(
      this.film.shots.map((shot) => this.loadShot(shot))
    )
  }

  private async loadShot(shot: Shot): Promise<ShotAssets> {
    const img = await loadImage(shot.logo.src)
    const aspect = imageAspect(img)
    const texW = Math.min(
      4096,
      Math.round(shot.logo.width * LOGO_TEXELS_PER_UNIT)
    )
    const canvas = toMask(rasterize(img, texW, aspect), shot.logo.mode)
    const lw = shot.logo.width
    const lh = lw / aspect
    return {
      logo: createImageTexture(this.gl, canvas),
      logoRect: [
        shot.logo.center[0] - lw / 2,
        shot.logo.center[1] - lh / 2,
        lw,
        lh
      ],
      logoTexels: [canvas.width, canvas.height]
    }
  }

  /** swaps a shot's logo for another and reloads its texture */
  async setLogo(index: number, logo: LogoSpec) {
    const shots = this.film.shots.map((s, i) =>
      i === index ? { ...s, logo } : s
    )
    this.film = { ...this.film, shots }
    const old = this.assets[index]
    this.assets[index] = await this.loadShot(shots[index]!)
    if (old) this.gl.deleteTexture(old.logo)
  }

  /** releases the GPU context (exports make a second engine and drop it when done) */
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  setParams(index: number, params: Partial<Params>) {
    this.params[index] = { ...this.params[index]!, ...params }
  }

  getParams(index: number) {
    return this.params[index]!
  }

  shotIndexAt(t: number) {
    const i = this.film.shots.findIndex((s) => t >= s.start && t < s.end)
    return i < 0 ? this.film.shots.length - 1 : i
  }

  /** the dome at shot time t (src/dome.ts) */
  domeAt(shot: Shot, t: number): DomeState {
    return domeAt(shot, this.params[this.film.shots.indexOf(shot)]!, t)
  }

  /**
   * Renders film time t to the canvas. The dither (the spectrum's sample offsets, grain) is seeded
   * by subframe alone, so a frame is a pure function of t and a still picture stays still. Live
   * playback may ask for fewer subframes than the shot's.
   */
  render(t: number, { subframes }: { subframes?: number } = {}) {
    const gl = this.gl
    const index = this.shotIndexAt(t)
    const shot = this.film.shots[index]!
    const p = this.params[index]!
    const a = this.assets[index]!
    const K = Math.max(1, Math.round(subframes ?? p.subframes))
    const open = p.shutter / this.film.fps

    clearTarget(gl, this.accum)
    for (let k = 0; k < K; k++) {
      // subframes span the shutter, centred on the frame's time
      const tk = Math.max(shot.start, t + open * ((k + 0.5) / K - 0.5))
      this.drawOptics(shot, a, p, tk - shot.start, k)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      this.passes.copy!.draw(this.accum, {
        uSrc: { tex: this.color.tex },
        uScale: 1 / K
      })
      gl.disable(gl.BLEND)
    }
    this.finish(p, interpolate(shot.fade, t - shot.start))
  }

  private drawOptics(
    shot: Shot,
    a: ShotAssets,
    p: Params,
    local: number,
    seed: number
  ) {
    const half = 1 / interpolate(shot.zoom, local)
    const d = this.domeAt(shot, local)
    const [cx, cy] = shot.dome.center
    // the rig's chrome tip stands at the dome's crown
    const ball = shot.ball
      ? [
          cx,
          cy,
          d.height + interpolate(shot.ball.lift, local),
          shot.ball.radius
        ]
      : [0, 0, 0, 0]
    const colour = shot.colour ? interpolate(shot.colour, local) : 1
    // the logo recedes about its centre
    const k = shot.recede ? interpolate(shot.recede, local) : 1
    const [lx, ly, lw, lh] = a.logoRect
    const logoRect = [
      lx + (lw * (1 - k)) / 2,
      ly + (lh * (1 - k)) / 2,
      lw * k,
      lh * k
    ]
    this.passes.optics!.draw(this.color, {
      uViewCenter: [0, 0],
      uViewHalfHeight: half,
      uAspect: this.film.aspect,
      uLogo: { tex: a.logo },
      uLogoRect: logoRect,
      uLogoTexels: a.logoTexels,
      uLogoColor: p.logoColor,
      uFloorColor: p.floorColor,
      uDepth: p.depth,
      uIorOil: p.iorOil,
      uDispersion: p.dispersion * colour,
      uDispersionKnee: p.dispersionKnee,
      uMaxSlope: p.maxSlope,
      uWavelengths: Math.round(p.wavelengths),
      uDefocus: p.defocus,
      uBlur: p.blur,
      uReflect: p.reflect * (shot.gloss ? interpolate(shot.gloss, local) : 1),
      uSoftbox: p.softbox,
      uHorizon: p.horizon,
      uRingLight: p.ringLight,
      uRingWidth: p.ringLightWidth,
      uBall: ball,
      uLensCenter: shot.dome.center,
      uLens: [d.radius, d.height, d.exponent],
      uLensAspect: d.aspect,
      uLensProfile: [d.crown, d.flat, d.shoulder],
      uLensEdge: d.edge,
      uLensRing: [d.ring, p.ringWidth, p.ringWavelength, d.ringReach],
      // the wave's crests travel outward at ringSpeed
      uLensRingPhase:
        p.ringWavelength > 0
          ? (2 * Math.PI * p.ringSpeed * local) / p.ringWavelength
          : 0,
      uRipple: [
        d.ripple,
        p.rippleWavelength,
        (2 * Math.PI * p.rippleSpeed * local) / p.rippleWavelength,
        p.rippleReach
      ],
      uReveal: p.reveal,
      uRevealSoft: p.revealSoft,
      uSeed: seed,
      uDebug: this.debug,
      uDebugScale: this.debugScale
    })
  }

  private finish(p: Params, fade: number) {
    // bloom: a mip chain down, then tent-filtered back up, each level adding the one below
    let src = this.accum
    for (const level of this.bloom) {
      this.passes.down!.draw(level, {
        uSrc: { tex: src.tex },
        uTexel: [1 / src.width, 1 / src.height]
      })
      src = level
    }
    let lo = this.bloom.at(-1)!
    for (let i = this.bloom.length - 2; i >= 0; i--) {
      const out = this.bloomUp[i]!
      this.passes.up!.draw(out, {
        uSrc: { tex: lo.tex },
        uBase: { tex: this.bloom[i]!.tex },
        uTexel: [1 / lo.width, 1 / lo.height],
        uRadius: p.bloomRadius
      })
      lo = out
    }
    this.passes.finish!.draw(null, {
      uSrc: { tex: this.accum.tex },
      uBloom: { tex: this.bloomUp[0]!.tex },
      uBloomAmount: p.bloom,
      uExposure: p.exposure,
      uFade: fade,
      uVignette: p.vignette,
      uGrain: p.grain,
      uSaturation: p.saturation,
      uGlowTint: p.glowTint,
      uBalance: p.balance,
      uBlack: p.black,
      uSeed: 0,
      uAspect: this.film.aspect
    })
  }
}
