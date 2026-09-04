// Pointer / wheel / keyboard → camera and tap events. Mouse, touch and pen share
// one path through pointer events. Coordinates handed out are device pixels.

import type { Camera } from './camera'

export interface InputHandlers {
  onTap(sx: number, sy: number, pointerType: string): void
  /** Middle-click or Alt+click: eyedropper. */
  onPick(sx: number, sy: number): void
  onHover(sx: number, sy: number | null): void
  onKey(key: string): boolean
}

const DRAG_THRESHOLD_CSS = 5

export function attachInput(el: HTMLCanvasElement, camera: Camera, h: InputHandlers): () => void {
  const dpr = () => window.devicePixelRatio || 1
  const pointers = new Map<number, { x: number; y: number }>()
  let down: { x: number; y: number; t: number } | null = null
  let dragging = false
  let lastMove = { x: 0, y: 0, t: 0 }
  let velocity = { x: 0, y: 0 }
  let pinch: { dist: number; mx: number; my: number } | null = null

  const local = (e: PointerEvent | WheelEvent): [number, number] => {
    const r = el.getBoundingClientRect()
    const d = dpr()
    return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]
  }

  const startPinch = () => {
    const [a, b] = [...pointers.values()]
    if (!a || !b) return
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
    down = null
    dragging = false
  }

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && (e.button === 1 || (e.button === 0 && e.altKey))) {
      e.preventDefault()
      const [x, y] = local(e)
      h.onPick(x, y)
      return
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return
    el.setPointerCapture(e.pointerId)
    const [x, y] = local(e)
    pointers.set(e.pointerId, { x, y })
    camera.stop()
    if (pointers.size === 2) return startPinch()
    if (pointers.size > 2) return
    down = { x, y, t: performance.now() }
    dragging = false
    lastMove = { x, y, t: performance.now() }
    velocity = { x: 0, y: 0 }
  }

  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e)
    if (!pointers.has(e.pointerId)) {
      h.onHover(x, y)
      return
    }
    pointers.set(e.pointerId, { x, y })
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()]
      if (!a || !b) return
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      if (pinch.dist > 0 && dist > 0) camera.zoomBy(Math.log2(dist / pinch.dist), mx, my, true)
      camera.panBy(mx - pinch.mx, my - pinch.my)
      pinch = { dist, mx, my }
      return
    }
    if (!down) return
    const now = performance.now()
    if (!dragging && Math.hypot(x - down.x, y - down.y) > DRAG_THRESHOLD_CSS * dpr()) dragging = true
    if (dragging) {
      camera.panBy(x - lastMove.x, y - lastMove.y)
      const dt = Math.max(1, now - lastMove.t) / 1000
      // Blend so a still finger before release kills the fling.
      velocity = { x: (x - lastMove.x) / dt * 0.6 + velocity.x * 0.4, y: (y - lastMove.y) / dt * 0.6 + velocity.y * 0.4 }
    }
    lastMove = { x, y, t: now }
    h.onHover(x, y)
  }

  const onUp = (e: PointerEvent) => {
    const [x, y] = local(e)
    pointers.delete(e.pointerId)
    if (pinch) {
      if (pointers.size < 2) pinch = null
      return
    }
    if (!down) return
    const now = performance.now()
    if (dragging) {
      if (now - lastMove.t < 60) camera.fling(velocity.x, velocity.y)
    } else {
      // No double-click zoom: painting two neighbouring pixels quickly must never move the camera.
      h.onTap(x, y, e.pointerType)
    }
    down = null
    dragging = false
  }

  const onCancel = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinch = null
    down = null
    dragging = false
  }

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const [x, y] = local(e)
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16
    else if (e.deltaMode === 2) dy *= 400
    // Trackpad pinch arrives as ctrl+wheel with small deltas; scale it up.
    const k = e.ctrlKey ? 0.012 : 0.0028
    camera.zoomBy(-dy * k, x, y)
  }

  const onLeave = () => h.onHover(0, null)

  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return
    if (e.ctrlKey || e.metaKey) return
    const step = 80 * dpr()
    switch (e.key) {
      case 'ArrowLeft': case 'a': case 'A': camera.nudge(step, 0); break
      case 'ArrowRight': case 'd': case 'D': camera.nudge(-step, 0); break
      case 'ArrowUp': case 'w': case 'W': camera.nudge(0, step); break
      case 'ArrowDown': case 's': case 'S': camera.nudge(0, -step); break
      case '+': case '=': case 'e': case 'E': camera.zoomBy(0.5, camera.vw / 2, camera.vh / 2); break
      case '-': case '_': case 'q': case 'Q': camera.zoomBy(-0.5, camera.vw / 2, camera.vh / 2); break
      default: if (!h.onKey(e.key)) return
    }
    e.preventDefault()
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('contextmenu', (e) => e.preventDefault())
  el.addEventListener('auxclick', (e) => e.preventDefault())
  window.addEventListener('keydown', onKey)
  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('pointerleave', onLeave)
    el.removeEventListener('wheel', onWheel)
    window.removeEventListener('keydown', onKey)
  }
}
