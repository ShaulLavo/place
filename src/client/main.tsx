import { createEffect } from 'solid-js'
import { render } from '@solidjs/web'
import { App } from './ui/App'
import { ClientBoard } from './board'
import { Camera } from './camera'
import { attachInput } from './input'
import { createRenderer, type Overlay, type Renderer } from './render'
import { fetchConfig, fetchSnapshot, Socket } from './net'
import * as S from './state'
import { CANVAS_H, CANVAS_W } from '../shared/config'
import { paletteRgb01 } from '../shared/palette'
import { pack, type ServerText } from '../shared/protocol'
import './style.css'

const canvas = document.getElementById('c') as HTMLCanvasElement
render(() => <App />, document.getElementById('ui')!)

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

function parseHash(): { x: number; y: number; lz: number } | null {
  const m = /^#(-?[\d.]+),(-?[\d.]+),([\d.]+)$/.exec(location.hash)
  if (!m) return null
  const x = Number(m[1]), y = Number(m[2]), z = Number(m[3])
  if (![x, y, z].every(Number.isFinite) || z <= 0) return null
  return { x, y, lz: Math.log2(z) }
}

async function boot() {
  const params = new URLSearchParams(location.search)
  const board = new ClientBoard()
  const camera = new Camera()
  let renderer: Renderer = await createRenderer(canvas, CANVAS_W, CANVAS_H, params.get('renderer'))
  S.setRendererName(renderer.name)
  let needsDraw = true

  const resize = () => {
    const dpr = window.devicePixelRatio || 1
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
    const bar = document.querySelector('.bar')
    renderer.resize(w, h)
    camera.setViewport(w, h, bar ? bar.getBoundingClientRect().height * dpr : 0)
    needsDraw = true
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)
  const barEl = document.querySelector('.bar')
  if (barEl) ro.observe(barEl)
  resize()
  const hash = parseHash()
  if (hash) camera.jumpTo(hash.x, hash.y, hash.lz)
  else camera.fit()

  // Any overlay signal change needs a redraw (the palette bar changes color, for instance).
  createEffect(() => [S.hover(), S.color()], () => { needsDraw = true })

  const config = await fetchConfig()
  S.setCooldownUntil(config.cooldownUntil)
  S.setServerOffset(config.serverTime - Date.now())

  const loadSnapshot = async () => {
    S.setLoading('Loading the canvas')
    const { bytes, seq } = await fetchSnapshot()
    board.loadSnapshot(bytes, seq)
    S.setLoading(null)
    needsDraw = true
  }
  await loadSnapshot()

  let resyncing = false
  const resync = async () => {
    if (resyncing) return
    resyncing = true
    try {
      await loadSnapshot()
      socket.reconnect()
    } catch (e) {
      console.error('[net] resync failed', e)
      S.showToast('Lost sync with the canvas, retrying')
      setTimeout(resync, 2000)
    } finally {
      resyncing = false
    }
  }

  // ---- placement ----
  const nudgePalette = () => {
    const bar = document.querySelector('.bar')
    bar?.animate([{ transform: 'translate(-50%, 0)' }, { transform: 'translate(-50%, -6px)' }, { transform: 'translate(-50%, 0)' }], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
  }
  const PLACE_MIN_ZOOM = 4 // below this a click flies in instead of painting; pixels are too small to aim at
  let pendingPlace: { index: number; prev: number } | null = null
  let pop: { x: number; y: number; t0: number } | null = null
  const revert = () => {
    if (!pendingPlace) return
    board.set(pendingPlace.index, pendingPlace.prev)
    pendingPlace = null
    needsDraw = true
  }
  const onAck = (m: Extract<ServerText, { t: 'ack' }>) => {
    S.setCooldownUntil(m.cooldownUntil)
    if (m.ok) pendingPlace = null
    else {
      revert()
      S.showToast(m.error === 'cooldown' ? 'Wait for the cooldown to finish' : "That pixel couldn't be placed")
    }
  }
  const placeAt = (x: number, y: number): boolean => {
    const c = S.color()
    if (c === null) { S.showToast('Pick a color first'); nudgePalette(); return false }
    if (S.cooldownUntil() > Date.now() + S.serverOffset) { S.showToast('Wait for the cooldown to finish'); return false }
    const index = y * CANVAS_W + x
    pendingPlace = { index, prev: board.colorAt(x, y) }
    board.set(index, c)
    needsDraw = true
    if (!socket.place(pack(x, y, c))) {
      revert()
      S.showToast('Reconnecting, try again in a moment')
      return false
    }
    pop = { x, y, t0: performance.now() }
    navigator.vibrate?.(8)
    return true
  }
  S.actions.zoomIn = () => camera.zoomBy(1, camera.vw / 2, camera.vh / 2)
  S.actions.zoomOut = () => camera.zoomBy(-1, camera.vw / 2, camera.vh / 2)
  S.actions.fit = () => { const [cx, cy] = camera.fitCenter(); camera.flyTo(cx, cy, camera.minLz) }
  S.actions.share = () => {
    navigator.clipboard?.writeText(location.href).then(() => S.showToast('Link copied'), () => S.showToast("Couldn't copy the link"))
  }

  // ---- socket ----
  const socket = new Socket({
    since: () => board.seq,
    onUpdates: (f) => {
      const r = board.applyFrame(f)
      if (r === 'gap') void resync()
      else needsDraw = true
    },
    onText: (m) => {
      switch (m.t) {
        case 'hello':
          S.setOnline(m.online)
          S.setCooldownUntil(m.cooldownUntil)
          S.setServerOffset(m.serverTime - Date.now())
          break
        case 'state': S.setOnline(m.online); break
        case 'ack': onAck(m); break
        case 'resync': void resync(); break
      }
    },
    onStatus: (s) => S.setStatus(s),
  })
  socket.connect()

  // ---- input ----
  const pixelAt = (sx: number, sy: number): [number, number] | null => {
    const [x, y] = camera.screenToCanvas(sx, sy)
    if (x < 0 || y < 0 || x >= CANVAS_W || y >= CANVAS_H) return null
    return [Math.floor(x), Math.floor(y)]
  }
  attachInput(canvas, camera, {
    onTap: (sx, sy, pointerType) => {
      const p = pixelAt(sx, sy)
      if (!p) return
      const isTouch = pointerType === 'touch'
      const dpr = window.devicePixelRatio || 1
      // Fingers need bigger targets than a cursor: fly in to 16 CSS px per pixel on touch, 8 with a mouse.
      const minZoom = (isTouch ? 8 : PLACE_MIN_ZOOM) * dpr
      if (camera.zoom < minZoom) {
        // Only fly in when the click clearly meant "paint here"; a bare click far out does nothing.
        if (S.color() !== null) camera.flyTo(p[0] + 0.5, p[1] + 0.5, Math.log2((isTouch ? 16 : 8) * dpr))
        return
      }
      placeAt(p[0], p[1])
    },
    onPick: (sx, sy) => {
      const p = pixelAt(sx, sy)
      if (!p) return
      S.setColor(board.colorAt(p[0], p[1]))
      S.showToast('Color picked')
    },
    onHover: (sx, sy) => {
      const p = sy === null ? null : pixelAt(sx, sy)
      const cur = S.hover()
      if ((p === null) !== (cur === null) || (p && cur && (p[0] !== cur[0] || p[1] !== cur[1]))) S.setHover(p)
    },
    onKey: (key) => {
      if (key === 'Escape') { S.setColor(null); return true }
      if (key === 'c' || key === 'C') {
        const p = S.hover()
        if (p) { S.setColor(board.colorAt(p[0], p[1])); S.showToast('Color picked') }
        return true
      }
      return false
    },
  })

  // ---- renderer loss ----
  const rebuild = async () => {
    console.warn('[render] context lost, rebuilding')
    try { renderer.destroy() } catch { /* already dead */ }
    renderer = await createRenderer(canvas, CANVAS_W, CANVAS_H, params.get('renderer'))
    renderer.onLost = () => void rebuild()
    S.setRendererName(renderer.name)
    resize()
    renderer.upload({ x: 0, y: 0, w: CANVAS_W, h: CANVAS_H }, board.rgba)
    needsDraw = true
  }
  renderer.onLost = () => void rebuild()

  // ---- URL hash ----
  let hashTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleHash = () => {
    if (hashTimer) return
    hashTimer = setTimeout(() => {
      hashTimer = null
      const z = camera.zoom
      const h = `#${camera.cx.toFixed(1)},${camera.cy.toFixed(1)},${z.toFixed(2)}`
      if (h !== location.hash) history.replaceState(null, '', h)
    }, 300)
  }

  // ---- frame loop ----
  const overlay: Overlay = { hover: null, selected: null, previewColor: null, gridAlpha: 0, pop: null }
  let last = performance.now()
  let statT = last
  let statApplied = 0
  let lastZoomShown = 0
  let lastView = { cx: NaN, cy: NaN, zoom: NaN, vw: NaN, vh: NaN }
  const frame = (t: number) => {
    const dt = Math.min(0.1, (t - last) / 1000)
    last = t
    const moving = camera.update(dt)
    const dirty = board.takeDirty()
    if (dirty) {
      renderer.upload(dirty, board.rgba)
      needsDraw = true
    }
    const view = camera.view()
    const viewChanged = view.cx !== lastView.cx || view.cy !== lastView.cy || view.zoom !== lastView.zoom || view.vw !== lastView.vw || view.vh !== lastView.vh
    if (pop) {
      if ((t - pop.t0) / 1000 > 0.4) pop = null
      needsDraw = true
    }
    if (moving || needsDraw || viewChanged) {
      lastView = view
      overlay.hover = S.hover()
      overlay.selected = null
      const c = S.color()
      overlay.previewColor = c === null ? null : paletteRgb01(c)
      overlay.gridAlpha = smoothstep(6, 14, view.zoom)
      overlay.pop = pop ? { x: pop.x, y: pop.y, t: (t - pop.t0) / 1000 } : null
      renderer.draw(view, overlay)
      needsDraw = false
      if (Math.abs(view.zoom - lastZoomShown) > 0.005 * view.zoom) { lastZoomShown = view.zoom; S.setZoom(view.zoom) }
      const ccx = Math.min(CANVAS_W - 1, Math.max(0, Math.floor(view.cx)))
      const ccy = Math.min(CANVAS_H - 1, Math.max(0, Math.floor(view.cy)))
      const cur = S.center()
      if (cur[0] !== ccx || cur[1] !== ccy) S.setCenter([ccx, ccy])
      if (!moving) scheduleHash()
    }
    if (t - statT >= 1000) {
      S.setRate((board.applied - statApplied) / ((t - statT) / 1000))
      statT = t
      statApplied = board.applied
    }
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  // Debug handle for the console and the smoke test.
  ;(window as unknown as { __place: unknown }).__place = {
    board, camera, get renderer() { return renderer },
    /** Draw synchronously with the current state (so a readback in the same task sees it). */
    redraw() {
      const view = camera.view()
      overlay.hover = S.hover(); overlay.selected = null
      const c = S.color()
      overlay.previewColor = c === null ? null : paletteRgb01(c)
      overlay.gridAlpha = smoothstep(6, 14, view.zoom)
      overlay.pop = null
      renderer.draw(view, overlay)
    },
  }
}

boot().catch((e) => {
  console.error(e)
  S.setLoading("The canvas couldn't load. Refresh to try again.")
})
