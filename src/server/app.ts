// The Elysia app: typed REST (consumed via Eden) + a raw binary WebSocket.
//
// Elysia WS rules (verified against 1.4.30, see PLAN.md):
//  - no `body` schema on the WS route, so binary frames arrive as Buffer untouched
//  - only sendBinary / publishBinary / server.publish emit binary; plain send() JSON-stringifies typed arrays
//  - never return a value from message()

import { Elysia } from 'elysia'
import { join } from 'node:path'
import { Board } from './board'
import { Cooldown } from './cooldown'
import { Store } from './store'
import { BROADCAST_INTERVAL_MS, CANVAS_H, CANVAS_W } from '../shared/config'
import { PALETTE_HEX } from '../shared/palette'
import { encodeUpdates, isValidPacked, type ServerText } from '../shared/protocol'

export interface AppOptions {
  board: Board
  cooldown: Cooldown
  store?: Store
  /** Directory of built client files to serve in production. */
  staticDir?: string
  /** Route prefix the client was built for (BASE_PATH), so direct access also resolves prefixed asset URLs. */
  basePath?: string
}

const TOPIC = 'board'
const COOKIE = 'pid'

function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

export function createApp({ board, cooldown, store, staticDir, basePath = '/' }: AppOptions) {
  // ---- broadcast batching ----
  let pending = new Uint32Array(4096)
  let pendingLen = 0
  let pendingFirstSeq = 0
  let online = 0
  let lastOnlineSent = -1

  const text = (m: ServerText) => JSON.stringify(m)

  // ---- snapshot cache (gzip, regenerated at most every 2 s when dirty) ----
  let snapCache: { seq: number; at: number; gz: Uint8Array<ArrayBuffer>; raw: Uint8Array<ArrayBuffer> } | null = null
  const snapshot = () => {
    const now = Date.now()
    if (!snapCache || (snapCache.seq !== board.seq && now - snapCache.at > 2000)) {
      const raw = new Uint8Array(board.data)
      snapCache = { seq: board.seq, at: now, raw, gz: new Uint8Array(Bun.gzipSync(raw, { level: 6 })) }
    }
    return snapCache
  }

  const app = new Elysia({
    websocket: {
      perMessageDeflate: false,
      backpressureLimit: 1 << 20,
      closeOnBackpressureLimit: true,
      idleTimeout: 120,
      maxPayloadLength: 64,
    },
  })
    // Anonymous identity: httpOnly cookie, assigned on first HTTP request.
    .derive({ as: 'global' }, ({ cookie, request }) => {
      const c = cookie[COOKIE]!
      let id = typeof c.value === 'string' && c.value.length >= 8 ? c.value : ''
      if (!id) {
        id = crypto.randomUUID()
        c.set({ value: id, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 })
      }
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
      return { userId: id, ip }
    })
    .get('/api/config', ({ userId }) => ({
      w: CANVAS_W,
      h: CANVAS_H,
      palette: PALETTE_HEX as readonly string[],
      cooldownMs: cooldown.cooldownMs,
      cooldownUntil: cooldown.nextAllowed(userId),
      serverTime: Date.now(),
      seq: board.seq,
    }))
    .get('/api/me', ({ userId }) => ({
      id: userId,
      cooldownUntil: cooldown.nextAllowed(userId),
      serverTime: Date.now(),
    }))
    .get('/api/canvas', ({ request }) => {
      const s = snapshot()
      const gzip = request.headers.get('accept-encoding')?.includes('gzip') ?? false
      return new Response(gzip ? s.gz : s.raw, {
        headers: {
          'content-type': 'application/octet-stream',
          'cache-control': 'no-store',
          'x-seq': String(s.seq),
          ...(gzip ? { 'content-encoding': 'gzip' } : {}),
        },
      })
    })
    .ws('/ws', {
      open(ws) {
        online++
        ws.subscribe(TOPIC)
        const { userId, query } = ws.data
        ws.sendText(text({
          t: 'hello', seq: board.seq, online, cooldownUntil: cooldown.nextAllowed(userId), serverTime: Date.now(),
        }))
        // Replay anything the client missed since its snapshot / last connection.
        const since = Number(query.since)
        if (Number.isFinite(since) && since >= 0 && since < board.seq) {
          const missed = board.since(since)
          if (missed) ws.sendBinary(encodeUpdates(since + 1, missed))
          else ws.sendText(text({ t: 'resync' }))
        }
      },
      message(ws, msg) {
        if (typeof msg === 'string' || !(msg instanceof Uint8Array) || msg.byteLength !== 4) return
        const packed = new DataView(msg.buffer, msg.byteOffset, 4).getUint32(0, true)
        const { userId } = ws.data
        if (!isValidPacked(packed)) {
          ws.sendText(text({ t: 'ack', ok: false, error: 'invalid', cooldownUntil: cooldown.nextAllowed(userId) }))
          return
        }
        const deadline = cooldown.tryPlace(userId)
        if (deadline === null) {
          ws.sendText(text({ t: 'ack', ok: false, error: 'cooldown', cooldownUntil: cooldown.nextAllowed(userId) }))
          return
        }
        const seq = board.apply(packed)
        store?.append(packed, hash32(userId))
        if (pendingLen === 0) pendingFirstSeq = seq
        if (pendingLen === pending.length) {
          const bigger = new Uint32Array(pending.length * 2)
          bigger.set(pending)
          pending = bigger
        }
        pending[pendingLen++] = packed
        ws.sendText(text({ t: 'ack', ok: true, seq, packed, cooldownUntil: deadline }))
      },
      close() {
        online--
      },
    })

  if (staticDir) {
    const prefix = basePath.replace(/^\/+|\/+$/g, '') // 'place' for '/place/'
    const index = Bun.file(join(staticDir, 'index.html'))
    const serve = (f: ReturnType<typeof Bun.file>, immutable: boolean) =>
      new Response(f, { headers: { 'content-type': f.type, ...(immutable ? { 'cache-control': 'public, max-age=31536000, immutable' } : { 'cache-control': 'no-cache' }) } })
    app.get('/*', async ({ params }) => {
      let rel = (params as Record<string, string>)['*'] ?? ''
      // Behind the mesh proxy the prefix is already stripped; hit directly, strip it here.
      if (prefix && (rel === prefix || rel.startsWith(prefix + '/'))) rel = rel.slice(prefix.length + 1)
      if (rel && !rel.includes('..')) {
        const f = Bun.file(join(staticDir, rel))
        if (await f.exists()) return serve(f, rel.startsWith('assets/'))
      }
      return serve(index, false)
    })
  }

  /** Flush queued placements to every subscriber. Called on a timer by start(). */
  const flush = () => {
    if (pendingLen === 0 || !app.server) return
    app.server.publish(TOPIC, encodeUpdates(pendingFirstSeq, pending, pendingLen), false)
    pendingLen = 0
  }

  const broadcastOnline = () => {
    if (!app.server || online === lastOnlineSent) return
    lastOnlineSent = online
    app.server.publish(TOPIC, text({ t: 'state', online }), false)
  }

  let timers: ReturnType<typeof setInterval>[] = []
  const start = () => {
    timers = [
      setInterval(flush, BROADCAST_INTERVAL_MS),
      setInterval(broadcastOnline, 2000),
      setInterval(() => cooldown.sweep(), 60_000),
    ]
  }
  const stop = () => {
    timers.forEach(clearInterval)
    timers = []
    flush()
  }

  return { app, flush, start, stop, get online() { return online } }
}

export type App = ReturnType<typeof createApp>['app']
