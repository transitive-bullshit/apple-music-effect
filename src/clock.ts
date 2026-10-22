// The preview clock. With a song, the audio element is the master; its currentTime only advances
// in coarse steps, so the picture follows a smooth clock that's eased back onto it every frame.
// Without one (no audio in the timeline, or the file isn't in media/), it runs on its own, silent.

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

export class PlaybackClock {
  readonly duration: number
  private audio: HTMLAudioElement | null
  /** song time at `baseAt` (performance.now()) */
  private base = 0
  private baseAt = 0
  private running = false

  constructor(duration: number, src: string | null) {
    this.duration = duration
    this.audio = src ? new Audio(src) : null
    const audio = this.audio
    if (!audio) return
    audio.preload = 'auto'
    audio.addEventListener('error', () => {
      console.warn(`${src} didn't load; playing silent`)
      this.audio = null
      this.base = audio.currentTime
    })
    audio.addEventListener('playing', () => this.start())
    audio.addEventListener('seeked', () => {
      if (!audio.paused) this.start()
    })
    for (const type of ['pause', 'waiting', 'seeking', 'ended'])
      audio.addEventListener(type, () => (this.running = false))
  }

  get playing() {
    return this.audio ? !this.audio.paused && !this.audio.ended : this.running
  }

  /** song time for a frame drawn at `now` */
  time(now = performance.now()) {
    const free = this.running
      ? this.base + (now - this.baseAt) / 1000
      : this.base
    if (!this.audio) {
      if (free >= this.duration) {
        this.running = false
        this.base = this.duration
      }
      return clamp(free, 0, this.duration)
    }
    const heard = clamp(this.audio.currentTime, 0, this.duration)
    if (!this.running) return heard
    const drift = heard - free
    if (Math.abs(drift) > 0.1) {
      this.start(now)
      return heard
    }
    this.base += drift * 0.03
    return clamp(free, 0, this.duration)
  }

  play() {
    if (this.time() >= this.duration - 0.05) this.seek(0)
    if (this.audio) void this.audio.play().catch(() => {})
    else this.start()
  }

  pause() {
    if (this.audio) this.audio.pause()
    else {
      this.base = this.time()
      this.running = false
    }
  }

  toggle() {
    if (this.playing) this.pause()
    else this.play()
  }

  seek(t: number) {
    const to = clamp(t, 0, this.duration)
    if (this.audio) this.audio.currentTime = to
    this.base = to
    this.baseAt = performance.now()
  }

  /** pause and move whole frames, landing on the frame grid of the rendered video */
  step(frames: number, fps: number) {
    const t = this.time()
    this.pause()
    this.seek((Math.round(t * fps) + frames) / fps)
  }

  private start(now = performance.now()) {
    if (this.audio) this.base = this.audio.currentTime
    this.baseAt = now
    this.running = true
  }
}
