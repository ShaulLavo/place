// Camera over the canvas. All screen coordinates are device pixels.
// State: center (canvas coords at viewport center) and log2 zoom; inputs move
// targets, update() eases toward them, so every gesture feels continuous.

import { CANVAS_H, CANVAS_W, MAX_LOG_ZOOM } from '../shared/config'

export interface View { cx: number; cy: number; zoom: number; vw: number; vh: number }

const EASE_RATE = 18 // 1/s, higher = snappier
const FLING_DECAY = 7 // 1/s

export class Camera {
  cx = CANVAS_W / 2
  cy = CANVAS_H / 2
  lz = 0
  tcx = this.cx
  tcy = this.cy
  tlz = 0
  vw = 1
  vh = 1
  /** Device px along the bottom covered by chrome (the palette bar); fit() keeps the canvas above it. */
  insetBottom = 0
  minLz = -3
  private vx = 0 // fling velocity, canvas px / s
  private vy = 0
  /** While zooming, keep this canvas point under this screen point. */
  private anchor: { sx: number; sy: number; px: number; py: number } | null = null

  get zoom(): number { return 2 ** this.lz }
  get targetZoom(): number { return 2 ** this.tlz }

  setViewport(vw: number, vh: number, insetBottom = this.insetBottom): void {
    this.vw = Math.max(1, vw)
    this.vh = Math.max(1, vh)
    this.insetBottom = Math.min(insetBottom, vh * 0.5)
    const free = this.vh - this.insetBottom
    this.minLz = Math.log2(Math.min((vw - 48) / CANVAS_W, (free - 100) / CANVAS_H))
    this.tlz = Math.max(this.minLz, this.tlz)
    this.lz = Math.max(this.minLz, this.lz)
  }

  /** Center that puts the canvas in the middle of the area above the bottom inset, at zoom 2^lz. */
  fitCenter(lz = this.minLz): [number, number] {
    return [CANVAS_W / 2, CANVAS_H / 2 + this.insetBottom / 2 / 2 ** lz]
  }

  /** Jump to a view without animation. */
  jumpTo(cx: number, cy: number, lz: number): void {
    this.cx = this.tcx = cx
    this.cy = this.tcy = cy
    this.lz = this.tlz = Math.min(MAX_LOG_ZOOM, Math.max(this.minLz, lz))
    this.vx = this.vy = 0
    this.anchor = null
    this.clampTargets()
    this.cx = this.tcx
    this.cy = this.tcy
  }

  fit(): void { const [cx, cy] = this.fitCenter(); this.jumpTo(cx, cy, this.minLz) }

  /** Animate to a view: center on (cx, cy) at log2 zoom lz. */
  flyTo(cx: number, cy: number, lz: number): void {
    this.anchor = null
    this.vx = this.vy = 0
    this.tcx = cx
    this.tcy = cy
    this.tlz = Math.min(MAX_LOG_ZOOM, Math.max(this.minLz, lz))
    this.clampTargets()
  }

  screenToCanvas(sx: number, sy: number, zoom = this.zoom, cx = this.cx, cy = this.cy): [number, number] {
    return [(sx - this.vw / 2) / zoom + cx, (sy - this.vh / 2) / zoom + cy]
  }

  /** Change zoom by dlz (log2 units) keeping the canvas point under (sx, sy) fixed. */
  zoomBy(dlz: number, sx: number, sy: number, immediate = false): void {
    const tlz = Math.min(MAX_LOG_ZOOM, Math.max(this.minLz, this.tlz + dlz))
    if (tlz === this.tlz) return
    // Anchor is taken from the *target* transform so rapid wheel ticks compose correctly.
    const [px, py] = this.screenToCanvas(sx, sy, this.targetZoom, this.tcx, this.tcy)
    this.anchor = { sx, sy, px, py }
    this.tlz = tlz
    this.vx = this.vy = 0
    if (immediate) this.lz = tlz
    this.applyAnchor(true)
  }

  /** Pan by a screen delta. Direct (no easing) so dragging is 1:1. */
  panBy(dsx: number, dsy: number): void {
    this.anchor = null
    this.tcx -= dsx / this.zoom
    this.tcy -= dsy / this.zoom
    this.clampTargets()
    this.cx = this.tcx
    this.cy = this.tcy
  }

  /** Animated pan (keyboard). */
  nudge(dsx: number, dsy: number): void {
    this.anchor = null
    this.tcx -= dsx / this.targetZoom
    this.tcy -= dsy / this.targetZoom
    this.clampTargets()
  }

  fling(vsx: number, vsy: number): void {
    this.vx = -vsx / this.zoom
    this.vy = -vsy / this.zoom
  }

  stop(): void { this.vx = this.vy = 0 }

  private clampTargets(): void {
    this.tcx = Math.min(CANVAS_W, Math.max(0, this.tcx))
    this.tcy = Math.min(CANVAS_H + this.insetBottom / this.targetZoom, Math.max(0, this.tcy))
  }

  private applyAnchor(toTarget: boolean): void {
    const a = this.anchor
    if (!a) return
    const z = toTarget ? this.targetZoom : this.zoom
    const cx = a.px - (a.sx - this.vw / 2) / z
    const cy = a.py - (a.sy - this.vh / 2) / z
    if (toTarget) {
      this.tcx = cx
      this.tcy = cy
      this.clampTargets()
    } else {
      this.cx = Math.min(CANVAS_W, Math.max(0, cx))
      this.cy = Math.min(CANVAS_H, Math.max(0, cy))
    }
  }

  /** Advance the animation. Returns true if still moving. */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-EASE_RATE * dt)
    let moving = false
    if (Math.abs(this.tlz - this.lz) > 1e-4) {
      this.lz += (this.tlz - this.lz) * k
      moving = true
    } else this.lz = this.tlz
    if (this.anchor) {
      this.applyAnchor(false)
      if (!moving) { this.anchor = null; this.tcx = this.cx; this.tcy = this.cy }
    } else {
      if (this.vx !== 0 || this.vy !== 0) {
        const decay = Math.exp(-FLING_DECAY * dt)
        this.tcx += this.vx * dt
        this.tcy += this.vy * dt
        this.vx *= decay
        this.vy *= decay
        if (Math.hypot(this.vx, this.vy) * this.zoom < 2) this.vx = this.vy = 0
        this.clampTargets()
        moving = true
      }
      const dx = this.tcx - this.cx
      const dy = this.tcy - this.cy
      if (Math.hypot(dx, dy) * this.zoom > 0.05) {
        this.cx += dx * k
        this.cy += dy * k
        moving = true
      } else { this.cx = this.tcx; this.cy = this.tcy }
    }
    return moving
  }

  /** The view to render. At zoom >= 1 the canvas origin is snapped to a device pixel. */
  view(): View {
    const zoom = this.zoom
    let { cx, cy } = this
    if (zoom >= 1) {
      const ox = Math.round(this.vw / 2 - cx * zoom)
      const oy = Math.round(this.vh / 2 - cy * zoom)
      cx = (this.vw / 2 - ox) / zoom
      cy = (this.vh / 2 - oy) / zoom
    }
    return { cx, cy, zoom, vw: this.vw, vh: this.vh }
  }
}
