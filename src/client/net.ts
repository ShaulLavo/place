// Networking: Eden Treaty for typed REST, a hand-written binary WebSocket for pixels.

import { treaty } from '@elysiajs/eden'
import type { App } from '../server/app'
import { decodeFrame, encodePlace, parseServerText, type ServerText, type UpdatesFrame } from '../shared/protocol'

/** Path the app is mounted at, with a trailing slash: '/' normally, '/place/' behind a route prefix. */
export const BASE = (() => {
  let p = location.pathname
  if (p.endsWith('/index.html')) p = p.slice(0, -'index.html'.length)
  return p.endsWith('/') ? p : p + '/'
})()

export const api = treaty<App>(location.origin + BASE.slice(0, -1))

export async function fetchConfig() {
  const { data, error } = await api.api.config.get()
  if (error || !data) throw new Error('config: ' + (error?.status ?? 'no data'))
  return data
}

export async function fetchSnapshot(): Promise<{ bytes: Uint8Array; seq: number }> {
  const r = await fetch(`${BASE}api/canvas`, { cache: 'no-store' })
  if (!r.ok) throw new Error('snapshot: ' + r.status)
  const seq = Number(r.headers.get('x-seq') ?? 0)
  return { bytes: new Uint8Array(await r.arrayBuffer()), seq }
}

export type SocketStatus = 'connecting' | 'online' | 'reconnecting' | 'offline'

export interface SocketHandlers {
  onUpdates(frame: UpdatesFrame): void
  onText(msg: ServerText): void
  onStatus(status: SocketStatus): void
  /** Called before each (re)connect to learn the last seq we hold. */
  since(): number
}

export class Socket {
  private ws: WebSocket | null = null
  private backoff = 500
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly h: SocketHandlers) {}

  connect(): void {
    if (this.closed) return
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${proto}//${location.host}${BASE}ws?since=${this.h.since()}`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    ws.onopen = () => {
      this.backoff = 500
      this.h.onStatus('online')
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const m = parseServerText(e.data)
        if (m) this.h.onText(m)
      } else {
        const f = decodeFrame(e.data as ArrayBuffer)
        if (f) this.h.onUpdates(f)
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      if (this.closed) return
      this.h.onStatus('reconnecting')
      this.timer = setTimeout(() => this.connect(), this.backoff)
      this.backoff = Math.min(10_000, this.backoff * 2)
    }
    ws.onerror = () => ws.close()
  }

  /** Drop the current connection and reconnect now (used after a full resync). */
  reconnect(): void {
    if (this.timer) clearTimeout(this.timer)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.connect()
  }

  place(packed: number): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(encodePlace(packed))
    return true
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
  }
}
