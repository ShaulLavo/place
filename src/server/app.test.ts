import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createApp } from './app'
import { Board } from './board'
import { Cooldown } from './cooldown'
import { decodeFrame, encodePlace, pack, parseServerText, type ServerText } from '../shared/protocol'
import { BLANK_COLOR } from '../shared/config'

let srv: ReturnType<typeof createApp>
let base = ''
let wsBase = ''
const board = new Board()

interface Client {
  ws: WebSocket
  texts: ServerText[]
  bins: ArrayBuffer[]
  wait: (pred: () => boolean, ms?: number) => Promise<void>
  close: () => void
}

function connect(query = '', cookie = ''): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws${query}`, { headers: cookie ? { cookie } : {} } as any)
    ws.binaryType = 'arraybuffer'
    const c: Client = {
      ws, texts: [], bins: [],
      wait: (pred, ms = 2000) => new Promise((res, rej) => {
        const t0 = Date.now()
        const tick = () => pred() ? res() : Date.now() - t0 > ms ? rej(new Error('timeout')) : setTimeout(tick, 5)
        tick()
      }),
      close: () => ws.close(),
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') c.texts.push(parseServerText(e.data)!)
      else c.bins.push(e.data as ArrayBuffer)
    }
    ws.onopen = () => resolve(c)
    ws.onerror = (e) => reject(e)
  })
}

beforeAll(() => {
  srv = createApp({ board, cooldown: new Cooldown(0) })
  srv.app.listen(0)
  const port = srv.app.server!.port
  base = `http://localhost:${port}`
  wsBase = `ws://localhost:${port}`
})
afterAll(() => { srv.stop(); srv.app.stop() })

describe('app', () => {
  test('config assigns an identity cookie and reports dims', async () => {
    const r = await fetch(`${base}/api/config`)
    const j = await r.json()
    expect(j.w).toBe(2000)
    expect(j.palette.length).toBe(32)
    expect(r.headers.get('set-cookie')).toContain('pid=')
  })

  test('canvas snapshot is gzip with X-Seq and decodes to the board', async () => {
    const r = await fetch(`${base}/api/canvas`)
    expect(r.headers.get('x-seq')).toBe(String(board.seq))
    const bytes = new Uint8Array(await r.arrayBuffer())
    expect(bytes.length).toBe(board.data.length)
    expect(bytes[0]).toBe(BLANK_COLOR)
  })

  test('binary place → ack + binary broadcast to another client', async () => {
    const a = await connect()
    const b = await connect()
    await a.wait(() => a.texts.some((m) => m.t === 'hello'))
    await b.wait(() => b.texts.some((m) => m.t === 'hello'))
    const hello = b.texts.find((m) => m.t === 'hello')! as Extract<ServerText, { t: 'hello' }>
    expect(hello.online).toBe(2)

    const p = pack(10, 20, 7)
    a.ws.send(encodePlace(p))
    await a.wait(() => a.texts.some((m) => m.t === 'ack'))
    const ack = a.texts.find((m) => m.t === 'ack')! as Extract<ServerText, { t: 'ack'; ok: true }>
    expect(ack.ok).toBe(true)
    expect(ack.packed).toBe(p)
    expect(board.data[20 * board.w + 10]).toBe(7)

    srv.flush()
    await b.wait(() => b.bins.length > 0)
    await a.wait(() => a.bins.length > 0)
    const f = decodeFrame(b.bins[0]!)!
    expect(f.firstSeq).toBe(ack.seq)
    expect(Array.from(f.packed)).toEqual([p])
    a.close(); b.close()
  })

  test('invalid placement is rejected without touching the board', async () => {
    const a = await connect()
    const seqBefore = board.seq
    a.ws.send(new Uint8Array([0xff, 0xff, 0xff, 0xff]))
    await a.wait(() => a.texts.some((m) => m.t === 'ack'))
    const ack = a.texts.find((m) => m.t === 'ack')!
    expect(ack.t === 'ack' && ack.ok).toBe(false)
    expect(board.seq).toBe(seqBefore)
    a.close()
  })

  test('reconnect with ?since replays the gap', async () => {
    const since = board.seq
    board.apply(pack(1, 1, 1))
    board.apply(pack(2, 2, 2))
    const a = await connect(`?since=${since}`)
    await a.wait(() => a.bins.length > 0)
    const f = decodeFrame(a.bins[0]!)!
    expect(f.firstSeq).toBe(since + 1)
    expect(Array.from(f.packed)).toEqual([pack(1, 1, 1), pack(2, 2, 2)])
    a.close()
  })

  test('cookie identity is honored on the socket and cooldown is enforced', async () => {
    const cd = new Cooldown(60_000)
    const s2 = createApp({ board: new Board(), cooldown: cd })
    s2.app.listen(0)
    const w = `ws://localhost:${s2.app.server!.port}`
    const mk = () => new Promise<Client>((resolve, reject) => {
      const ws = new WebSocket(`${w}/ws`, { headers: { cookie: 'pid=user-one-fixed-id' } } as any)
      ws.binaryType = 'arraybuffer'
      const c: Client = { ws, texts: [], bins: [], close: () => ws.close(),
        wait: (pred, ms = 2000) => new Promise((res, rej) => {
          const t0 = Date.now()
          const tick = () => pred() ? res() : Date.now() - t0 > ms ? rej(new Error('timeout')) : setTimeout(tick, 5)
          tick()
        }) }
      ws.onmessage = (e) => { if (typeof e.data === 'string') c.texts.push(parseServerText(e.data)!) }
      ws.onopen = () => resolve(c); ws.onerror = reject
    })
    const a = await mk()
    a.ws.send(encodePlace(pack(0, 0, 1)))
    a.ws.send(encodePlace(pack(0, 0, 2)))
    await a.wait(() => a.texts.filter((m) => m.t === 'ack').length === 2)
    const acks = a.texts.filter((m) => m.t === 'ack') as Extract<ServerText, { t: 'ack' }>[]
    expect(acks[0]!.ok).toBe(true)
    expect(acks[1]!.ok).toBe(false)
    expect(acks[1]!.ok === false && acks[1]!.error).toBe('cooldown')
    expect(cd.nextAllowed('user-one-fixed-id')).toBeGreaterThan(0)
    a.close(); s2.stop(); s2.app.stop()
  })
})
