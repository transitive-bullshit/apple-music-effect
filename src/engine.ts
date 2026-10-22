// The engine: per shot, an oil simulation stepped at a fixed, stable rate from rest at the shot's
// start, and an optics pass that renders it. A frame accumulates several subframes across the
// shutter (motion blur, and more wavelength samples), then bloom and the finish.
//
// The simulation only runs forward; drawing an earlier time restarts the shot and steps it again,
// so any frame is a pure function of its time.

import {
  imageAspect,
  loadImage,
  rasterize,
  footprintCoverage,
  signedDistance,
  toMask
} from './assets'
import { interpolate, rigHeight, wobble } from './driver'
import {
  clearTarget,
  createContext,
  createFloatTexture,
  createImageTexture,
  createPass,
  createTarget,
  type Pass,
  type Target
} from './gl'
import { lensState } from './lens'
import {
  type Film,
  type LensState,
  type LogoSpec,
  type Params,
  paramsFor,
  type Shot
} from './scene'
import {
  COPY,
  DOWNSAMPLE,
  FINISH,
  OPTICS,
  SIM_DEPTH,
  SIM_FLUX,
  SIM_INIT,
  UPSAMPLE
} from './shaders'

export interface EngineOptions {
  width: number
  height: number
  /** simulation cells along the frame's height */
  simRows?: number
  /** simulated domain relative to the frame at zoom 1 */
  margin?: number
  preserveDrawingBuffer?: boolean
}

interface ShotAssets {
  logo: WebGLTexture
  logoRect: [number, number, number, number]
  logoTexels: [number, number]
  sdf: WebGLTexture | null
  sdfRect: [number, number, number, number]
}

/** logo texels per world unit (the frame is 2 units tall) */
const LOGO_TEXELS_PER_UNIT = 1400
const SDF_TEXELS_PER_UNIT = 600
const BLOOM_LEVELS = 6

export class Engine {
  readonly gl: WebGL2RenderingContext
  film: Film
  readonly width: number
  readonly height: number
  readonly grid: [number, number]
  readonly dx: number
  readonly domain: [number, number, number, number]

  private assets: ShotAssets[] = []
  private params: Params[]
  private state: [Target, Target]
  private color: Target
  private accum: Target
  private bloom: Target[] = []
  private bloomUp: Target[] = []
  private passes: Record<string, Pass>
  private shotIndex = -1
  private simTime = 0
  /** 0: the picture; 1: surface height, 2: slope, 3: glass (scaled by debugScale) */
  debug = 0
  debugScale = 0.05

  private constructor(
    canvas: HTMLCanvasElement,
    film: Film,
    opts: EngineOptions
  ) {
    this.film = film
    this.width = opts.width
    this.height = opts.height
    canvas.width = opts.width
    canvas.height = opts.height
    const gl = createContext(canvas, opts.preserveDrawingBuffer)
    this.gl = gl
    this.params = film.shots.map(paramsFor)

    const rows = opts.simRows ?? 576
    const margin = opts.margin ?? 1.12
    const halfH = margin
    const halfW = margin * film.aspect
    this.dx = (2 * halfH) / rows
    this.grid = [Math.round((2 * halfW) / this.dx), rows]
    this.domain = [
      -this.grid[0] * this.dx * 0.5,
      -halfH,
      this.grid[0] * this.dx,
      2 * halfH
    ]
    this.state = [
      createTarget(gl, ...this.grid),
      createTarget(gl, ...this.grid)
    ]
    this.color = createTarget(gl, this.width, this.height, {
      format: 'rgba32f'
    })
    this.accum = createTarget(gl, this.width, this.height, {
      format: 'rgba32f',
      filter: 'linear'
    })
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
    this.passes = {
      flux: createPass(gl, SIM_FLUX),
      init: createPass(gl, SIM_INIT),
      depth: createPass(gl, SIM_DEPTH),
      optics: createPass(gl, OPTICS),
      copy: createPass(gl, COPY),
      down: createPass(gl, DOWNSAMPLE),
      up: createPass(gl, UPSAMPLE),
      finish: createPass(gl, FINISH)
    }
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
    this.shotIndex = -1
  }

  private async loadShot(shot: Shot): Promise<ShotAssets> {
    const gl = this.gl
    const img = await loadImage(shot.logo.src)
    const aspect = imageAspect(img)
    const texW = Math.min(
      4096,
      Math.round(shot.logo.width * LOGO_TEXELS_PER_UNIT)
    )
    const canvas = toMask(rasterize(img, texW, aspect), shot.logo.mode)
    const logo = createImageTexture(gl, canvas)
    const lw = shot.logo.width
    const lh = lw / aspect
    const logoRect: ShotAssets['logoRect'] = [
      shot.logo.center[0] - lw / 2,
      shot.logo.center[1] - lh / 2,
      lw,
      lh
    ]

    let sdf: WebGLTexture | null = null
    let sdfRect: ShotAssets['sdfRect'] = [0, 0, 1, 1]
    if (shot.cover) {
      const [cw, ch] = shot.cover.size
      const rw = cw * 1.3 + 0.2
      const rh = ch * 1.3 + 0.2
      sdfRect = [
        shot.cover.center[0] - rw / 2,
        shot.cover.center[1] - rh / 2,
        rw,
        rh
      ]
      const gw = Math.round(rw * SDF_TEXELS_PER_UNIT)
      const gh = Math.round(rh * SDF_TEXELS_PER_UNIT)
      const coverage = footprintCoverage(
        shot.cover.footprint,
        gw,
        gh,
        cw * SDF_TEXELS_PER_UNIT,
        ch * SDF_TEXELS_PER_UNIT
      )
      // distance in world units, rows flipped so texture v runs up like world y
      const d = signedDistance(coverage, gw, gh)
      const flipped = new Float32Array(gw * gh)
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++)
          flipped[(gh - 1 - y) * gw + x] = d[y * gw + x]! / SDF_TEXELS_PER_UNIT
      sdf = createFloatTexture(gl, gw, gh, flipped)
    }
    return {
      logo,
      logoRect,
      logoTexels: [canvas.width, canvas.height],
      sdf,
      sdfRect
    }
  }

  /** swaps a shot's logo for another and reloads its textures */
  async setLogo(index: number, logo: LogoSpec) {
    const shots = this.film.shots.map((s, i) =>
      i === index ? { ...s, logo } : s
    )
    this.film = { ...this.film, shots }
    const old = this.assets[index]
    this.assets[index] = await this.loadShot(shots[index]!)
    if (old) {
      this.gl.deleteTexture(old.logo)
      if (old.sdf) this.gl.deleteTexture(old.sdf)
    }
    if (index === this.shotIndex) this.shotIndex = -1
  }

  /** releases the GPU context (exports make a second engine and drop it when done) */
  dispose() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }

  setParams(index: number, params: Partial<Params>) {
    this.params[index] = { ...this.params[index]!, ...params }
    // the oil must be stepped again under the new parameters
    if (index === this.shotIndex) this.shotIndex = -1
  }

  getParams(index: number) {
    return this.params[index]!
  }

  shotIndexAt(t: number) {
    const i = this.film.shots.findIndex((s) => t >= s.start && t < s.end)
    return i < 0 ? this.film.shots.length - 1 : i
  }

  /** the stable time step for the shot's parameters */
  private timeStep(p: Params) {
    // gravity for the chosen wave speed at rest depth; waves over a bulge run a little faster
    const g = (p.waveSpeed * p.waveSpeed) / p.depth
    const hMax = 1.6 * p.depth
    const dx = this.dx
    // symplectic Euler is stable below dt = 2 / omega_max; omega² = h (g k² + tension k⁴)
    const omega2 = hMax * ((8 * g) / (dx * dx) + (64 * p.tension) / dx ** 4)
    const wave = 1.6 / Math.sqrt(omega2)
    const visc = p.viscosity > 0 ? (dx * dx) / (8 * p.viscosity) : Infinity
    return Math.min(wave, 0.9 * visc, 1 / 240)
  }

  /** the rod's push at shot time t: keyframes plus its oscillation */
  private pushAt(shot: Shot, t: number) {
    return interpolate(shot.push, t) + wobble(shot.pushWobble, t)
  }

  /** the dome at shot time t (src/lens.ts) */
  lensStateAt(shot: Shot, t: number, scaled = true): LensState {
    return lensState(
      shot,
      this.params[this.film.shots.indexOf(shot)]!,
      t,
      scaled
    )
  }

  /** the dome as the shaders take it: radius, height, exponent */
  private lensAt(shot: Shot, t: number): [number, number, number] {
    const l = this.lensStateAt(shot, t)
    return [l.radius, l.height, l.exponent]
  }

  private lensUniforms(shot: Shot, local: number) {
    const l = this.lensStateAt(shot, local)
    return {
      uLensCenter: shot.lens ? shot.lens.center : [0, 0],
      uLensEdge: l.edge,
      uLensProfile: [l.crown, l.flat, l.shoulder],
      uLensShift: [l.shiftX, l.shiftY],
      uLensWarp: [l.tiltX, l.tiltY, l.astig, l.skew],
      uLensRing: [l.ring, l.ringWidth, l.ringWave]
    }
  }

  private coverUniforms(shot: Shot, a: ShotAssets, p: Params, local: number) {
    const cover = shot.cover
    return {
      uSdf: { tex: a.sdf ?? a.logo },
      uSdfRect: a.sdfRect,
      uHasCover: cover ? 1 : 0,
      uCoverCenter: cover ? cover.center : [0, 0],
      uCoverHalf: cover ? [cover.size[0] / 2, cover.size[1] / 2] : [1, 1],
      uRigZ: rigHeight(shot.rig, shot.wobble, local),
      ...this.lensUniforms(shot, local),
      uCrown: p.crown,
      uBevel: p.bevel,
      uBevelWidth: p.bevelWidth,
      uCoverTilt: [
        interpolate(shot.tilt[0], local),
        interpolate(shot.tilt[1], local)
      ]
    }
  }

  private resetShot(index: number) {
    const shot = this.film.shots[index]!
    const p = this.params[index]!
    clearTarget(this.gl, this.state[1])
    this.passes.init!.draw(this.state[0], {
      ...this.coverUniforms(shot, this.assets[index]!, p, 0),
      uGrid: this.grid,
      uDomain: this.domain,
      uDx: this.dx,
      uH0: p.depth
    })
    this.shotIndex = index
    this.simTime = 0
  }

  /** steps the shot's oil forward to shot time `local` */
  private advance(local: number) {
    const shot = this.film.shots[this.shotIndex]!
    const a = this.assets[this.shotIndex]!
    const p = this.params[this.shotIndex]!
    const dt = this.timeStep(p)
    const common = {
      uGrid: this.grid,
      uDomain: this.domain,
      uDx: this.dx,
      uDt: dt,
      uSponge: 20,
      uH0: p.depth
    }
    while (this.simTime + dt <= local + 1e-9) {
      const t = this.simTime + dt * 0.5
      const cover = this.coverUniforms(shot, a, p, t)
      this.passes.flux!.draw(this.state[1], {
        ...common,
        ...cover,
        uState: { tex: this.state[0].tex },
        uG: (p.waveSpeed * p.waveSpeed) / p.depth,
        uTension: p.tension,
        uViscosity: p.viscosity,
        uFilmViscosity: p.filmViscosity,
        uDamping: p.damping,
        uHMin: p.hMin
      })
      this.passes.depth!.draw(this.state[0], {
        ...common,
        ...this.coverUniforms(shot, a, p, this.simTime + dt),
        uState: { tex: this.state[1].tex },
        uRigVel:
          (this.pushAt(shot, t + 1e-4) - this.pushAt(shot, t - 1e-4)) / 2e-4,
        uSourceCenter: shot.cover ? shot.cover.center : shot.logo.center,
        uSourceCenterAmp: p.sourceCenter,
        uSourceRadius: p.sourceRadius,
        uLens0: this.lensAt(shot, this.simTime),
        uLens1: this.lensAt(shot, this.simTime + dt),
        uLensRelease: p.lensRelease,
        uDisplace: p.displace
      })
      this.simTime += dt
    }
  }

  /**
   * Renders film time t to the canvas. The dither (the spectrum's sample offsets, grain) is seeded
   * by subframe alone, so a frame is a pure function of t and a still picture stays still.
   */
  render(t: number) {
    const gl = this.gl
    const index = this.shotIndexAt(t)
    const shot = this.film.shots[index]!
    const p = this.params[index]!
    const a = this.assets[index]!
    const K = Math.max(1, Math.round(p.subframes))
    const open = p.shutter / this.film.fps

    clearTarget(gl, this.accum)
    for (let k = 0; k < K; k++) {
      // subframes span the shutter, centred on the frame's time
      const tk = Math.max(shot.start, t + open * ((k + 0.5) / K - 0.5))
      const local = tk - shot.start
      if (index !== this.shotIndex || local < this.simTime - 1e-9)
        this.resetShot(index)
      this.advance(local)
      this.drawOptics(shot, a, p, local, k)
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
    const zoom = interpolate(shot.zoom, local)
    const half = 1 / zoom
    const cover = this.coverUniforms(shot, a, p, local)
    const lens = this.lensAt(shot, local)
    // the rig's chrome tip stands at the dome's crown
    const center = shot.lens?.center ?? shot.cover?.center ?? [0, 0]
    const ball = shot.ball
      ? [
          center[0],
          center[1],
          lens[1] + interpolate(shot.ball.lift, local),
          shot.ball.radius
        ]
      : [0, 0, 0, 0]
    this.passes.optics!.draw(this.color, {
      ...cover,
      uState: { tex: this.state[0].tex },
      uGrid: this.grid,
      uDomain: this.domain,
      uDx: this.dx,
      uViewCenter: [0, 0],
      uViewHalfHeight: half,
      uAspect: this.film.aspect,
      uPixel: [(2 * half) / this.height, (2 * half) / this.height],
      uLogo: { tex: a.logo },
      uLogoRect: a.logoRect,
      uLogoTexels: a.logoTexels,
      uLogoColor: p.logoColor,
      uFloorColor: p.floorColor,
      uDepth: p.depth,
      uIorOil: p.iorOil,
      uIorGlass: p.iorGlass,
      uDispersion:
        p.dispersion * (shot.colour ? interpolate(shot.colour, local) : 1),
      uDispersionKnee: p.dispersionKnee,
      uMaxSlope: p.maxSlope,
      uWavelengths: Math.round(p.wavelengths),
      uDefocus: p.defocus,
      uBlur: p.blur,
      uReflect: p.reflect,
      uSoftbox: p.softbox,
      uHorizon: p.horizon,
      uMeniscus: p.meniscus,
      uFilm: p.film,
      uCoverOn: p.coverOn,
      uBall: ball,
      uLens: lens,
      uRipple: [
        this.lensStateAt(shot, local).ripple,
        p.rippleWavelength,
        (2 * Math.PI * p.rippleSpeed * local) / p.rippleWavelength,
        p.rippleReach
      ],
      uReveal: shot.lens ? p.reveal : 0,
      uRevealSoft: p.revealSoft,
      uSeed: seed % 997,
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
      uSeed: 0,
      uAspect: this.film.aspect
    })
  }
}
