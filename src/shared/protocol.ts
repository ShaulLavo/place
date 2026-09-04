// Wire protocol. Everything little-endian.
//
// Binary frames (server -> client):
//   [type:u8][flags:u8][reserved:u16][firstSeq:u32][packed:u32 * n]
//   header is 8 bytes so the payload is u32-aligned for a zero-copy view.
//
// Binary frames (client -> server):
//   [packed:u32]   one placement
//
// Text frames (both directions): JSON, discriminated on `t`.

import { CANVAS_W, COLOR_BITS, COLOR_MASK, PIXEL_COUNT } from './config'
import { PALETTE_SIZE } from './palette'

export const FRAME_HEADER = 8

export const enum FrameType {
  Updates = 1,
}

export interface Pixel { x: number; y: number; color: number }

/** Pack (x, y, color) into one u32: index << 5 | color. */
export function pack(x: number, y: number, color: number): number {
  return (((y * CANVAS_W + x) << COLOR_BITS) | color) >>> 0
}

export function packIndex(index: number, color: number): number {
  return ((index << COLOR_BITS) | color) >>> 0
}

export function unpackIndex(p: number): number {
  return p >>> COLOR_BITS
}

export function unpackColor(p: number): number {
  return p & COLOR_MASK
}

export function unpack(p: number): Pixel {
  const i = unpackIndex(p)
  return { x: i % CANVAS_W, y: (i / CANVAS_W) | 0, color: unpackColor(p) }
}

/** True if the packed value addresses a real pixel with a real color. */
export function isValidPacked(p: number): boolean {
  return unpackIndex(p) < PIXEL_COUNT && unpackColor(p) < PALETTE_SIZE
}

export function encodeUpdates(firstSeq: number, packed: ArrayLike<number>, count = packed.length): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(FRAME_HEADER + count * 4)
  const dv = new DataView(buf.buffer)
  dv.setUint8(0, FrameType.Updates)
  dv.setUint32(4, firstSeq >>> 0, true)
  const u32 = new Uint32Array(buf.buffer, FRAME_HEADER, count)
  for (let i = 0; i < count; i++) u32[i] = packed[i]!
  return buf
}

export interface UpdatesFrame { type: FrameType.Updates; firstSeq: number; packed: Uint32Array }

export function decodeFrame(data: ArrayBuffer): UpdatesFrame | null {
  if (data.byteLength < FRAME_HEADER || (data.byteLength - FRAME_HEADER) % 4 !== 0) return null
  const dv = new DataView(data)
  const type = dv.getUint8(0)
  if (type !== FrameType.Updates) return null
  const firstSeq = dv.getUint32(4, true)
  // Only aligned if the ArrayBuffer starts at offset 0, which it does for WS messages.
  const packed = new Uint32Array(data, FRAME_HEADER)
  return { type, firstSeq, packed }
}

export function encodePlace(packed: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, packed >>> 0, true)
  return buf
}

// ---- JSON text messages ----

export type ServerText =
  | { t: 'hello'; seq: number; online: number; cooldownUntil: number; serverTime: number }
  | { t: 'ack'; ok: true; seq: number; packed: number; cooldownUntil: number }
  | { t: 'ack'; ok: false; error: string; cooldownUntil: number }
  | { t: 'state'; online: number }
  | { t: 'resync' }

export function parseServerText(s: string): ServerText | null {
  try {
    const v = JSON.parse(s)
    return v && typeof v.t === 'string' ? (v as ServerText) : null
  } catch {
    return null
  }
}
