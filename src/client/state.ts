// UI state as Solid signals. The render loop writes, components read.
// Pixel data never goes through here.

import { createSignal } from 'solid-js'
import type { SocketStatus } from './net'

const params = new URLSearchParams(location.search)
export const debug = params.has('debug')
/** Coarse pointer (touch): placing needs an explicit confirm, like r/place mobile. */
export const touch = matchMedia('(pointer: coarse)').matches

export const [hover, setHover] = createSignal<[number, number] | null>(null)
/** Pixel under the viewport center; what the coords pill shows when nothing is hovered or selected. */
export const [center, setCenter] = createSignal<[number, number]>([0, 0])
export const [color, setColor] = createSignal<number | null>(null)
export const [cooldownUntil, setCooldownUntil] = createSignal(0)
export const [online, setOnline] = createSignal(0)
export const [status, setStatus] = createSignal<SocketStatus>('connecting')
export const [rendererName, setRendererName] = createSignal('')
export const [zoom, setZoom] = createSignal(1)
export const [rate, setRate] = createSignal(0)
export const [loading, setLoading] = createSignal<string | null>('Loading the canvas')
export const [toast, setToast] = createSignal<string | null>(null)
export const [now, setNow] = createSignal(Date.now())
setInterval(() => setNow(Date.now()), 100)

/** Server clock minus local clock, so cooldown deadlines display correctly. */
export let serverOffset = 0
export function setServerOffset(v: number): void { serverOffset = v }

/** Wired up by main.tsx once the board and socket exist. */
export const actions = {
  zoomIn: (): void => {},
  zoomOut: (): void => {},
  fit: (): void => {},
  share: (): void => {},
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
export function showToast(msg: string, ms = 2200): void {
  setToast(msg)
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setToast(null), ms)
}
