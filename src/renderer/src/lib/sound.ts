/**
 * 纸墨 · 界面音效
 *
 * 全部用 WebAudio 现场合成，不带一个音频文件：
 *  - 体积为零，随主题/风格调整只是改几个数字
 *  - 不会出现 <audio> 的加载延迟和播放抖动
 *
 * 设计原则（模仿系统级 UI 音的做法）：
 *  1. 每一击都很短，最长 180ms，绝不拖住操作
 *  2. 音量压低（默认 -24dB 左右），是"感觉到"而不是"听到"
 *  3. 只在一件事**确实发生**时响：文件真打开了、真存盘了
 *  4. 同一动作不叠加，键盘连续敲不会变成噪音
 */

type Voice = 'open' | 'save' | 'switch' | 'error' | 'tick'

const STORAGE_KEY = 'zhimo:sound'

class SoundKit {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private enabled = true
  private volume = 0.5
  /** 同一音效的最小间隔，防止连点糊成一片 */
  private lastAt: Partial<Record<Voice, number>> = {}

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      if (typeof saved.enabled === 'boolean') this.enabled = saved.enabled
      if (typeof saved.volume === 'number') this.volume = saved.volume
    } catch {
      /* 用默认值 */
    }
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(v: boolean): void {
    this.enabled = v
    this.persist()
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.volume * 0.12, this.ctx.currentTime, 0.02)
    }
    this.persist()
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: this.enabled, volume: this.volume }))
    } catch {
      /* 忽略 */
    }
  }

  /** AudioContext 必须懒建：浏览器要求首次交互之后才能出声 */
  private ensure(): AudioContext | null {
    if (!this.enabled || (!this.ctx && !navigator.userActivation?.hasBeenActive)) return null
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      /* 0.12 是整体压得很低的那一档 */
      this.master.gain.value = this.volume * 0.12
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
    return this.ctx
  }

  /** 生成一段白噪声，用于所有"纸/摩擦"类声音 */
  private noise(ctx: AudioContext, dur: number): AudioBufferSourceNode {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer
    return src
  }

  /**
   * 包络：极快起音 + 指数衰减。
   * 起音快是"清脆"的关键，衰减指数才像真实物体振动。
   */
  private env(gain: GainNode, peak: number, attack: number, decay: number, t0 = (this.ctx?.currentTime ?? 0) + 0.001): void {
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay)
  }

  play(voice: Voice): void {
    const now = performance.now()
    const gap: Record<Voice, number> = { open: 90, save: 200, switch: 45, error: 250, tick: 30 }
    if (now - (this.lastAt[voice] ?? 0) < gap[voice]) return
    this.lastAt[voice] = now

    const ctx = this.ensure()
    if (!ctx || !this.master) return
    const t0 = ctx.currentTime + 0.001

    switch (voice) {
      case 'open':
        this.paperRustle(ctx, t0)
        break
      case 'save':
        this.stamp(ctx, t0)
        break
      case 'switch':
        this.softClick(ctx, t0)
        break
      case 'error':
        this.reject(ctx, t0)
        break
      case 'tick':
        this.tick(ctx, t0)
        break
    }
  }

  /** 翻纸：两层带通噪声，一层扫频，像指尖划过纸面 */
  private paperRustle(ctx: AudioContext, t0: number): void {
    const dur = 0.1
    const src = this.noise(ctx, dur)

    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 0.9
    bp.frequency.setValueAtTime(900, t0)
    bp.frequency.exponentialRampToValueAtTime(2700, t0 + dur)

    const g = ctx.createGain()
    this.env(g, 0.55, 0.006, dur)

    src.connect(bp).connect(g).connect(this.master!)
    src.start(t0)
    src.stop(t0 + dur + 0.02)

    /* 高频的"沙"层，让质感更薄更纸 */
    const hsrc = this.noise(ctx, 0.055)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 3400
    const hg = ctx.createGain()
    this.env(hg, 0.14, 0.004, 0.055)
    hsrc.connect(hp).connect(hg).connect(this.master!)
    hsrc.start(t0 + 0.012)
    hsrc.stop(t0 + 0.09)
  }

  /** 落印：低频下坠 + 一点点墨的摩擦 */
  private stamp(ctx: AudioContext, t0: number): void {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, t0)
    osc.frequency.exponentialRampToValueAtTime(58, t0 + 0.15)

    const g = ctx.createGain()
    this.env(g, 0.6, 0.005, 0.17)
    osc.connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + 0.2)

    /* 印面接触纸的一声轻响 */
    const src = this.noise(ctx, 0.028)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = 2400
    const ng = ctx.createGain()
    this.env(ng, 0.3, 0.002, 0.026)
    src.connect(hp).connect(ng).connect(this.master!)
    src.start(t0)
    src.stop(t0 + 0.04)
  }

  /** 轻点：两个很短的音，像木头/陶瓷 */
  private softClick(ctx: AudioContext, t0: number): void {
    const mk = (freq: number, peak: number, dur: number, delay: number): void => {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, t0 + delay)
      const g = ctx.createGain()
      this.env(g, peak, 0.003, dur, t0 + delay)
      osc.connect(g).connect(this.master!)
      osc.start(t0 + delay)
      osc.stop(t0 + delay + dur + 0.02)
    }
    mk(1180, 0.2, 0.032, 0)
    mk(590, 0.1, 0.04, 0.006)
  }

  /** 拒绝：短促下行，不用刺耳的方波 */
  private reject(ctx: AudioContext, t0: number): void {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(210, t0)
    osc.frequency.exponentialRampToValueAtTime(150, t0 + 0.13)

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 780

    const g = ctx.createGain()
    this.env(g, 0.22, 0.008, 0.15)
    osc.connect(lp).connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + 0.18)
  }

  /** 极轻的一声，用于焦点移动之类 */
  private tick(ctx: AudioContext, t0: number): void {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = 1680
    const g = ctx.createGain()
    this.env(g, 0.07, 0.002, 0.02)
    osc.connect(g).connect(this.master!)
    osc.start(t0)
    osc.stop(t0 + 0.03)
  }
}

export const sound = new SoundKit()
export type { Voice }
