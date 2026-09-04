import { todayJulianDay } from '../../lib/julianDate'

export type ClockSnapshot = {
  julianDay: number
  isPlaying: boolean
  rateDaysPerSecond: number
  revision: number
  seekRevision: number
}

type Listener = () => void

/**
 * Animation-time clock that lives outside React. Subscribers are notified at a
 * deliberately bounded cadence; renderers may read `getJulianDay()` every frame.
 */
export class SimulationClock {
  private julianDay = todayJulianDay()
  private rateDaysPerSecond = 30
  private isPlaying = false
  private lastTimestamp: number | null = null
  private animationFrame: number | null = null
  private lastPublishedAt = 0
  private revision = 0
  private seekRevision = 0
  private listeners = new Set<Listener>()
  private readonly publishIntervalMs: number
  private snapshot: ClockSnapshot = {
    julianDay: this.julianDay,
    isPlaying: this.isPlaying,
    rateDaysPerSecond: this.rateDaysPerSecond,
    revision: this.revision,
    seekRevision: this.seekRevision,
  }

  constructor(publishIntervalMs = 125) {
    this.publishIntervalMs = publishIntervalMs
  }

  getJulianDay = () => this.julianDay

  getSnapshot = (): ClockSnapshot => this.snapshot

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  seek(julianDay: number) {
    if (!Number.isFinite(julianDay)) return
    this.julianDay = julianDay
    this.seekRevision += 1
    this.publish()
  }

  setRate(rateDaysPerSecond: number) {
    if (!Number.isFinite(rateDaysPerSecond)) return
    this.rateDaysPerSecond = Math.max(-20_000, Math.min(20_000, rateDaysPerSecond))
    this.publish()
  }

  play() {
    if (this.isPlaying) return
    this.isPlaying = true
    this.lastTimestamp = null
    this.publish()
    this.schedule()
  }

  pause() {
    if (!this.isPlaying) return
    this.isPlaying = false
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = null
    }
    this.lastTimestamp = null
    this.publish()
  }

  toggle() {
    if (this.isPlaying) this.pause()
    else this.play()
  }

  dispose() {
    this.pause()
    this.listeners.clear()
  }

  private schedule() {
    if (this.animationFrame !== null || !this.isPlaying) return
    this.animationFrame = requestAnimationFrame(this.tick)
  }

  private tick = (timestamp: number) => {
    this.animationFrame = null
    if (!this.isPlaying) return
    if (this.lastTimestamp !== null) {
      const elapsedSeconds = Math.min((timestamp - this.lastTimestamp) / 1000, 0.25)
      this.julianDay += elapsedSeconds * this.rateDaysPerSecond
    }
    this.lastTimestamp = timestamp
    if (timestamp - this.lastPublishedAt >= this.publishIntervalMs) {
      this.lastPublishedAt = timestamp
      this.publish()
    }
    this.schedule()
  }

  private publish() {
    this.revision += 1
    this.snapshot = {
      julianDay: this.julianDay,
      isPlaying: this.isPlaying,
      rateDaysPerSecond: this.rateDaysPerSecond,
      revision: this.revision,
      seekRevision: this.seekRevision,
    }
    for (const listener of this.listeners) listener()
  }
}

export const simulationClock = new SimulationClock()
