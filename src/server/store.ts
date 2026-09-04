// Persistence: atomic snapshot of the board + append-only placement log.
//
// canvas.bin: 32-byte header + PIXEL_COUNT bytes
//   [magic 'PLC1'][w:u32][h:u32][seq:u32][logOffset:f64][timestamp:f64]
// log.bin: 16-byte records [ts:f64][packed:u32][userHash:u32]

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { Board } from './board'
import { CANVAS_H, CANVAS_W, PIXEL_COUNT } from '../shared/config'

const MAGIC = 0x31434c50 // 'PLC1' little-endian
const HEADER = 32
const REC = 16

export class Store {
  private readonly snapPath: string
  private readonly logPath: string
  private logFd: number
  private logOffset: number
  private pending: Uint8Array = new Uint8Array(REC * 1024)
  private pendingLen = 0
  private snapshottedSeq = -1
  private lastLogged = 0
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true })
    this.snapPath = join(dir, 'canvas.bin')
    this.logPath = join(dir, 'log.bin')
    this.logFd = openSync(this.logPath, 'a')
    this.logOffset = fstatSync(this.logFd).size
  }

  /** True when load() found no usable data and returned a blank board. */
  fresh = false

  /** Load a Board from disk, replaying the log tail. Fresh board if nothing usable exists. */
  load(): Board {
    let board: Board
    let replayFrom = 0
    if (existsSync(this.snapPath)) {
      const buf = readFileSync(this.snapPath)
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      if (buf.byteLength === HEADER + PIXEL_COUNT && dv.getUint32(0, true) === MAGIC
        && dv.getUint32(4, true) === CANVAS_W && dv.getUint32(8, true) === CANVAS_H) {
        board = new Board(new Uint8Array(buf.buffer.slice(buf.byteOffset + HEADER, buf.byteOffset + HEADER + PIXEL_COUNT)), dv.getUint32(12, true))
        replayFrom = dv.getFloat64(16, true)
      } else {
        // Different canvas dimensions: the log's pixel indices mean something else now. Keep both files aside.
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        console.warn(`[store] ${this.snapPath} has wrong dims/format; moving old data to *.${stamp}.old and starting fresh`)
        this.flushLog()
        closeSync(this.logFd)
        renameSync(this.snapPath, `${this.snapPath}.${stamp}.old`)
        if (existsSync(this.logPath)) renameSync(this.logPath, `${this.logPath}.${stamp}.old`)
        this.logFd = openSync(this.logPath, 'a')
        this.logOffset = 0
        board = new Board()
      }
    } else {
      board = new Board()
    }
    this.fresh = board.seq === 0 && this.logOffset === 0
    // Replay log records written after the snapshot.
    if (this.logOffset > replayFrom) {
      const log = readFileSync(this.logPath)
      const dv = new DataView(log.buffer, log.byteOffset, log.byteLength)
      let n = 0
      for (let off = replayFrom; off + REC <= log.byteLength; off += REC) {
        board.apply(dv.getUint32(off + 8, true))
        n++
      }
      if (n) console.log(`[store] replayed ${n} log records`)
    }
    this.snapshottedSeq = board.seq
    this.lastLogged = board.seq
    return board
  }

  /** Queue a placement for the log. */
  append(packed: number, userHash: number, ts = Date.now()): void {
    if (this.pendingLen + REC > this.pending.length) {
      const bigger = new Uint8Array(this.pending.length * 2)
      bigger.set(this.pending)
      this.pending = bigger
    }
    const dv = new DataView(this.pending.buffer, this.pendingLen, REC)
    dv.setFloat64(0, ts, true)
    dv.setUint32(8, packed >>> 0, true)
    dv.setUint32(12, userHash >>> 0, true)
    this.pendingLen += REC
    this.lastLogged++
  }

  flushLog(): void {
    if (!this.pendingLen) return
    writeSync(this.logFd, this.pending, 0, this.pendingLen)
    this.logOffset += this.pendingLen
    this.pendingLen = 0
  }

  /** Write the snapshot atomically if the board changed since the last one (or when forced). */
  snapshot(board: Board, force = false): boolean {
    if (!force && board.seq === this.snapshottedSeq) return false
    this.flushLog()
    const buf = new Uint8Array(HEADER + PIXEL_COUNT)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, MAGIC, true)
    dv.setUint32(4, CANVAS_W, true)
    dv.setUint32(8, CANVAS_H, true)
    dv.setUint32(12, board.seq, true)
    dv.setFloat64(16, this.logOffset, true)
    dv.setFloat64(24, Date.now(), true)
    buf.set(board.data, HEADER)
    const tmp = this.snapPath + '.tmp'
    writeFileSync(tmp, buf)
    renameSync(tmp, this.snapPath)
    this.snapshottedSeq = board.seq
    return true
  }

  start(board: Board, logEveryMs = 1000, snapshotEveryMs = 10_000): void {
    let tick = 0
    this.timer = setInterval(() => {
      this.flushLog()
      if (++tick * logEveryMs >= snapshotEveryMs) {
        tick = 0
        this.snapshot(board)
      }
    }, logEveryMs)
  }

  close(board: Board): void {
    if (this.timer) clearInterval(this.timer)
    this.snapshot(board)
    closeSync(this.logFd)
  }
}
