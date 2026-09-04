// Load generator: N socket clients placing random pixels at a total rate, measuring
// ack RTT and broadcast latency (send → own pixel seen in a broadcast frame).
// Usage: bun scripts/loadtest.ts [wsUrl] [clients] [pixelsPerSec] [seconds]
import { CANVAS_H, CANVAS_W } from '../src/shared/config'
import { PALETTE_SIZE } from '../src/shared/palette'
import { decodeFrame, encodePlace, pack, parseServerText } from '../src/shared/protocol'

const url = process.argv[2] ?? 'ws://localhost:3000/ws'
const N = Number(process.argv[3] ?? 200)
const RATE = Number(process.argv[4] ?? 2000)
const SECONDS = Number(process.argv[5] ?? 10)

interface C { ws: WebSocket; sent: Map<number, number>; rtts: number[]; bcast: number[]; frames: number; pixels: number; bytes: number; ackErr: number }
const clients: C[] = []
let open = 0

const pct = (a: number[], p: number) => a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]! : NaN

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(url, { headers: { cookie: `pid=loadtest-${i}-${Math.random().toString(36).slice(2)}` } } as unknown as string[])
  ws.binaryType = 'arraybuffer'
  const c: C = { ws, sent: new Map(), rtts: [], bcast: [], frames: 0, pixels: 0, bytes: 0, ackErr: 0 }
  clients.push(c)
  ws.onopen = () => { open++ }
  ws.onmessage = (e) => {
    const now = performance.now()
    if (typeof e.data === 'string') {
      const m = parseServerText(e.data)
      if (m?.t === 'ack') {
        if (m.ok) { const t0 = c.sent.get(m.packed); if (t0 !== undefined) c.rtts.push(now - t0) }
        else c.ackErr++
      }
      return
    }
    const buf = e.data as ArrayBuffer
    c.bytes += buf.byteLength
    const f = decodeFrame(buf)
    if (!f) return
    c.frames++
    c.pixels += f.packed.length
    if (c.sent.size) for (const p of f.packed) { const t0 = c.sent.get(p); if (t0 !== undefined) { c.bcast.push(now - t0); c.sent.delete(p) } }
  }
}

await new Promise<void>((r) => { const t = setInterval(() => { if (open >= N) { clearInterval(t); r() } }, 20) })
console.log(`${N} clients connected to ${url}; sending ${RATE} px/s for ${SECONDS}s`)

let sentTotal = 0
const perTick = RATE / 100
let carry = 0
const start = performance.now()
const tick = setInterval(() => {
  carry += perTick
  while (carry >= 1) {
    carry--
    const c = clients[Math.floor(Math.random() * N)]!
    if (c.ws.readyState !== WebSocket.OPEN) continue
    const p = pack(Math.floor(Math.random() * CANVAS_W), Math.floor(Math.random() * CANVAS_H), Math.floor(Math.random() * PALETTE_SIZE))
    c.sent.set(p, performance.now())
    c.ws.send(encodePlace(p))
    sentTotal++
  }
}, 10)

await new Promise((r) => setTimeout(r, SECONDS * 1000))
clearInterval(tick)
await new Promise((r) => setTimeout(r, 500))
const elapsed = (performance.now() - start) / 1000

const rtts = clients.flatMap((c) => c.rtts)
const bc = clients.flatMap((c) => c.bcast)
const frames = clients.reduce((s, c) => s + c.frames, 0)
const pixels = clients.reduce((s, c) => s + c.pixels, 0)
const bytes = clients.reduce((s, c) => s + c.bytes, 0)
const errs = clients.reduce((s, c) => s + c.ackErr, 0)
const lost = clients.reduce((s, c) => s + c.sent.size, 0)
console.log(`sent      ${sentTotal} (${(sentTotal / elapsed).toFixed(0)}/s)  ack errors ${errs}  unconfirmed ${lost}`)
console.log(`received  ${pixels} px across all clients = ${(pixels / N).toFixed(0)} per client (expect ≈ ${sentTotal}); ${frames} frames; ${(bytes / 1024 / 1024).toFixed(1)} MiB total, ${(bytes / N / elapsed / 1024).toFixed(1)} KiB/s per client`)
console.log(`ack rtt   p50 ${pct(rtts, 0.5).toFixed(1)}ms  p99 ${pct(rtts, 0.99).toFixed(1)}ms  (n=${rtts.length})`)
console.log(`broadcast p50 ${pct(bc, 0.5).toFixed(1)}ms  p99 ${pct(bc, 0.99).toFixed(1)}ms  (n=${bc.length}; includes the ${50}ms coalescing window)`)
clients.forEach((c) => c.ws.close())
process.exit(0)
