// Default artwork for a fresh canvas, in the spirit of a fully colonized r/place: the canvas is
// carved into territories (flags, banners, sprite mosaics, gradients, patterns, scenes), then the
// big landmarks go on top: a rainbow road, the Void, the blue corner, a text wall, the wordmark.
// Deterministic, so every fresh deployment starts from the same picture.

import { CANVAS_H, CANVAS_W } from '../shared/config'
import type { Board } from './board'

// Palette indices (see shared/palette.ts).
const C = {
  darkRed: 0, red: 1, orange: 2, amber: 3, yellow: 4, cream: 5, darkGreen: 6, green: 7, lime: 8,
  darkTeal: 9, teal: 10, cyan: 11, darkBlue: 12, blue: 13, lightBlue: 14, indigo: 15, periwinkle: 16,
  lavender: 17, darkPurple: 18, purple: 19, paleP: 20, magenta: 21, pink: 22, lightPink: 23,
  darkBrown: 24, brown: 25, beige: 26, black: 27, darkGray: 28, gray: 29, lightGray: 30, white: 31,
} as const

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 5x7 bitmap font.
const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

// 8x8 sprites. '0' transparent, '1'..'3' color slots.
const SPRITES: Record<string, string[]> = {
  smiley: ['00111100', '01111110', '11211211', '11111111', '12111121', '11222211', '01111110', '00111100'],
  heart: ['01100110', '11111111', '11111111', '11111111', '01111110', '00111100', '00011000', '00000000'],
  star: ['00011000', '00011000', '00111100', '11111111', '01111110', '00111100', '01100110', '11000011'],
  ghost: ['00111100', '01111110', '12211221', '12211221', '11111111', '11111111', '11111111', '10100101'],
  mushroom: ['00111100', '01111110', '11211211', '11111111', '01111110', '00222200', '00222200', '00222200'],
  invader: ['00100100', '00011000', '00111100', '01111110', '11111111', '10111101', '10100101', '00011000'],
  skull: ['00111100', '01111110', '11111111', '10011001', '11111111', '01111110', '00100100', '00111100'],
  diamond: ['00011000', '00111100', '01111110', '11111111', '01111110', '00111100', '00011000', '00000000'],
  cat: ['10000001', '11000011', '11111111', '12111121', '11111111', '11121111', '01111110', '00111100'],
  flower: ['00011000', '00111100', '01111110', '11122111', '11122111', '01111110', '00111100', '00011000'],
  tree: ['00011000', '00111100', '01111110', '00111100', '01111110', '11111111', '00222200', '00222200'],
  crown: ['10000001', '11000011', '11011011', '11111111', '11111111', '11111111', '11111111', '00000000'],
  moon: ['00011110', '00111000', '01110000', '11100000', '11100000', '01110000', '00111000', '00011110'],
  rocket: ['00011000', '00111100', '00111100', '01121110', '01121110', '11111111', '00100100', '01000010'],
  note: ['00001111', '00001001', '00001001', '00001001', '00001001', '01111001', '11111001', '01110000'],
  fish: ['00000010', '01110110', '11111110', '11211111', '11111110', '01110110', '00000010', '00000000'],
  house: ['00011000', '00111100', '01111110', '11111111', '01221110', '01221110', '01221110', '00000000'],
  duck: ['00111000', '01121100', '01111100', '01111000', '11111100', '11111110', '01111100', '00111000'],
}
const SPRITE_NAMES = Object.keys(SPRITES)

export class Painter {
  constructor(readonly data: Uint8Array, readonly w = CANVAS_W, readonly h = CANVAS_H) {}

  set(x: number, y: number, c: number): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c
  }
  get(x: number, y: number): number {
    return this.data[y * this.w + x] ?? C.white
  }
  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c)
  }
  frame(x: number, y: number, w: number, h: number, t: number, c: number): void {
    this.rect(x, y, w, t, c); this.rect(x, y + h - t, w, t, c); this.rect(x, y, t, h, c); this.rect(x + w - t, y, t, h, c)
  }
  disc(cx: number, cy: number, r: number, c: number): void {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) this.set(cx + i, cy + j, c)
  }
  /** Draw a bitmap (array of digit strings) at (x, y), scaled by s; digit n maps to colors[n-1]. */
  bitmap(rows: readonly string[], x: number, y: number, s: number, colors: readonly number[]): void {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const d = row.charCodeAt(i) - 48
        if (d > 0 && colors[d - 1] !== undefined) this.rect(x + i * s, y + j * s, s, s, colors[d - 1]!)
      }
    })
  }
  static textWidth(str: string, s: number): number { return str.length * 6 * s - s }
  /** Text in the 5x7 font, optionally with a 1-cell outline. */
  text(str: string, x: number, y: number, s: number, c: number, outline?: number): void {
    let cx = x
    for (const ch of str.toUpperCase()) {
      const g = FONT[ch] ?? FONT[' ']!
      if (outline !== undefined) {
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) this.bitmap(g, cx + dx * s, y + dy * s, s, [outline])
      }
      this.bitmap(g, cx, y, s, [c])
      cx += 6 * s
    }
  }
  /** Ordered-dither gradient from color a to b across the rect (horizontal or vertical). */
  gradient(x: number, y: number, w: number, h: number, stops: readonly number[], vertical: boolean): void {
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const t = (vertical ? j / h : i / w) * (stops.length - 1)
      const k = Math.min(stops.length - 2, Math.floor(t))
      const frac = t - k
      const th = (bayer[((j & 3) << 2) | (i & 3)]! + 0.5) / 16
      this.set(x + i, y + j, frac > th ? stops[k + 1]! : stops[k]!)
    }
  }
}

interface Rect { x: number; y: number; w: number; h: number }

type Flag = { kind: 'h' | 'v'; c: number[] } | { kind: 'disc'; bg: number; fg: number } | { kind: 'cross'; bg: number; fg: number } | { kind: 'nordic'; bg: number; fg: number; inner?: number } | { kind: 'canton'; stripes: number[]; canton: number }
const FLAGS: Flag[] = [
  { kind: 'v', c: [C.blue, C.white, C.red] }, { kind: 'v', c: [C.green, C.white, C.red] }, { kind: 'h', c: [C.black, C.red, C.yellow] },
  { kind: 'h', c: [C.red, C.white, C.blue] }, { kind: 'h', c: [C.blue, C.yellow] }, { kind: 'h', c: [C.white, C.red] },
  { kind: 'v', c: [C.black, C.yellow, C.red] }, { kind: 'v', c: [C.green, C.white, C.orange] }, { kind: 'h', c: [C.red, C.white, C.red] },
  { kind: 'h', c: [C.red, C.white, C.green] }, { kind: 'h', c: [C.blue, C.black, C.white] }, { kind: 'h', c: [C.yellow, C.green, C.red] },
  { kind: 'h', c: [C.white, C.green, C.red] }, { kind: 'v', c: [C.blue, C.yellow, C.red] }, { kind: 'h', c: [C.yellow, C.yellow, C.blue, C.red] },
  { kind: 'h', c: [C.lightBlue, C.white, C.lightBlue] }, { kind: 'h', c: [C.red, C.white, C.darkBlue, C.darkBlue, C.white, C.red] },
  { kind: 'h', c: [C.orange, C.white, C.green] }, { kind: 'v', c: [C.green, C.white, C.green] }, { kind: 'v', c: [C.orange, C.white, C.green] },
  { kind: 'h', c: [C.red, C.blue, C.orange] }, { kind: 'h', c: [C.red, C.white, C.lightBlue] }, { kind: 'h', c: [C.red, C.white] },
  { kind: 'h', c: [C.red, C.yellow, C.yellow, C.red] }, { kind: 'v', c: [C.green, C.white, C.red] }, { kind: 'v', c: [C.green, C.red] },
  { kind: 'h', c: [C.lightBlue, C.lightPink, C.white, C.lightPink, C.lightBlue] },
  { kind: 'h', c: [C.red, C.orange, C.yellow, C.green, C.blue, C.purple] },
  { kind: 'disc', bg: C.white, fg: C.red }, { kind: 'disc', bg: C.green, fg: C.red }, { kind: 'disc', bg: C.lightBlue, fg: C.yellow },
  { kind: 'cross', bg: C.red, fg: C.white }, { kind: 'nordic', bg: C.red, fg: C.white }, { kind: 'nordic', bg: C.blue, fg: C.yellow },
  { kind: 'nordic', bg: C.white, fg: C.blue }, { kind: 'nordic', bg: C.red, fg: C.white, inner: C.darkBlue }, { kind: 'nordic', bg: C.blue, fg: C.white, inner: C.red },
  { kind: 'canton', stripes: [C.red, C.white], canton: C.darkBlue }, { kind: 'canton', stripes: [C.blue, C.white], canton: C.blue },
]

const WORDS = ['PLACE', 'HELLO', 'WORLD', 'DRAW HERE', 'TOGETHER', 'PIXELS', 'ART', 'LOVE', '2026', 'OMARCHY', 'BUN', 'SOLID', 'WEBGPU',
  'CANVAS', 'FOREVER', 'NEVER FORGET', 'WE DID IT', 'NO VOID', 'THE VOID', 'GG', 'HI MOM', '42', 'OK', 'MESH', 'TAILNET', 'LIVE', 'GLHF',
  'ONE PIXEL', 'AT A TIME', 'HOLD THE LINE', 'ALL YOURS', 'PAINT ME', 'WHY', 'YES', 'HELP', 'SEND HELP', 'RIP', 'HYPE', 'MORE', 'LESS', 'OK BUT WHY']

const PALETTE_ALL: number[] = Object.values(C)
const BRIGHT: number[] = [C.red, C.orange, C.amber, C.yellow, C.green, C.lime, C.teal, C.cyan, C.blue, C.lightBlue, C.periwinkle, C.purple, C.magenta, C.pink]
const DARK: number[] = [C.darkRed, C.darkGreen, C.darkTeal, C.darkBlue, C.indigo, C.darkPurple, C.darkBrown, C.black, C.darkGray]

export function seedBoard(board: Board, seed = 2022): void {
  const p = new Painter(board.data, board.w, board.h)
  const rnd = mulberry32(seed)
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!
  const W = board.w, H = board.h

  // ---- 1. Territories: partition into a jittered grid, merge some cells, paint each one. ----
  const CELL = 100
  const cols = Math.floor(W / CELL), rows = Math.floor(H / CELL)
  const taken = new Uint8Array(cols * rows)
  const rects: Rect[] = []
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (taken[r * cols + c]) continue
    let cw = 1, ch = 1
    const roll = rnd()
    if (roll < 0.18 && c + 1 < cols && !taken[r * cols + c + 1]) cw = 2
    if (roll >= 0.18 && roll < 0.32 && r + 1 < rows && !taken[(r + 1) * cols + c]) ch = 2
    if (roll >= 0.32 && roll < 0.42 && c + 1 < cols && r + 1 < rows && !taken[r * cols + c + 1] && !taken[(r + 1) * cols + c] && !taken[(r + 1) * cols + c + 1]) { cw = 2; ch = 2 }
    if (roll >= 0.42 && roll < 0.47 && c + 2 < cols && !taken[r * cols + c + 1] && !taken[r * cols + c + 2]) cw = 3
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) taken[(r + j) * cols + c + i] = 1
    rects.push({ x: c * CELL, y: r * CELL, w: cw * CELL, h: ch * CELL })
  }

  const paintFlag = (r: Rect, f: Flag) => {
    const { x, y, w, h } = r
    switch (f.kind) {
      case 'h': f.c.forEach((c, i) => p.rect(x, y + Math.round((i * h) / f.c.length), w, Math.ceil(h / f.c.length), c)); break
      case 'v': f.c.forEach((c, i) => p.rect(x + Math.round((i * w) / f.c.length), y, Math.ceil(w / f.c.length), h, c)); break
      case 'disc': p.rect(x, y, w, h, f.bg); p.disc(x + (w >> 1), y + (h >> 1), Math.floor(Math.min(w, h) * 0.3), f.fg); break
      case 'cross': { p.rect(x, y, w, h, f.bg); const t = Math.floor(Math.min(w, h) * 0.2); const l = Math.floor(Math.min(w, h) * 0.62)
        p.rect(x + ((w - t) >> 1), y + ((h - l) >> 1), t, l, f.fg); p.rect(x + ((w - l) >> 1), y + ((h - t) >> 1), l, t, f.fg); break }
      case 'nordic': { p.rect(x, y, w, h, f.bg); const t = Math.floor(h * 0.16); const cx = x + Math.floor(w * 0.36)
        p.rect(cx - (t >> 1), y, t, h, f.fg); p.rect(x, y + ((h - t) >> 1), w, t, f.fg)
        if (f.inner !== undefined) { const t2 = Math.max(2, t >> 1); p.rect(cx - (t2 >> 1), y, t2, h, f.inner); p.rect(x, y + ((h - t2) >> 1), w, t2, f.inner) } break }
      case 'canton': { const n = 7; for (let i = 0; i < n; i++) p.rect(x, y + Math.round((i * h) / n), w, Math.ceil(h / n), f.stripes[i % 2]!)
        p.rect(x, y, Math.floor(w * 0.42), Math.round((4 * h) / n), f.canton)
        for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) p.rect(x + 6 + i * Math.floor(w * 0.1), y + 6 + j * Math.floor(h * 0.18), 3, 3, C.white); break }
    }
  }

  const paintBanner = (r: Rect) => {
    const bg = pick(PALETTE_ALL), word = pick(WORDS)
    const ink = DARK.includes(bg) || bg === C.blue || bg === C.purple || bg === C.red ? C.white : C.black
    p.rect(r.x, r.y, r.w, r.h, bg)
    p.frame(r.x, r.y, r.w, r.h, 2, ink)
    const s = Math.max(2, Math.floor(Math.min((r.w - 16) / (word.length * 6 - 1), (r.h - 16) / 7)))
    p.text(word, r.x + Math.round((r.w - Painter.textWidth(word, s)) / 2), r.y + Math.round((r.h - 7 * s) / 2), s, ink)
  }

  const paintMosaic = (r: Rect) => {
    const bg = pick([...BRIGHT, C.white, C.cream, C.lightGray, C.black, C.darkBlue])
    p.rect(r.x, r.y, r.w, r.h, bg)
    const name = pick(SPRITE_NAMES), s = pick([3, 4, 5]), step = 8 * s + s * 2
    const c1 = pick(BRIGHT.filter((c) => c !== bg)), c2 = bg === C.black ? C.white : C.black, c3 = pick(BRIGHT)
    for (let y = r.y + s; y + 8 * s <= r.y + r.h; y += step) for (let x = r.x + s; x + 8 * s <= r.x + r.w; x += step) p.bitmap(SPRITES[name]!, x, y, s, [c1, c2, c3])
  }

  const paintSolid = (r: Rect) => {
    const bg = pick(PALETTE_ALL)
    p.rect(r.x, r.y, r.w, r.h, bg)
    p.frame(r.x, r.y, r.w, r.h, 3, DARK.includes(bg) ? C.white : C.black)
    const s = Math.floor(Math.min(r.w, r.h) / 10)
    const name = pick(SPRITE_NAMES)
    p.bitmap(SPRITES[name]!, r.x + ((r.w - 8 * s) >> 1), r.y + ((r.h - 8 * s) >> 1), s, [DARK.includes(bg) ? pick(BRIGHT) : pick([...DARK, C.white]), DARK.includes(bg) ? C.black : C.white, pick(BRIGHT)])
  }

  const paintGradient = (r: Rect) => {
    const n = 2 + Math.floor(rnd() * 3)
    const stops = Array.from({ length: n }, () => pick(PALETTE_ALL))
    p.gradient(r.x, r.y, r.w, r.h, stops, rnd() < 0.5)
  }

  const paintPattern = (r: Rect) => {
    const a = pick(PALETTE_ALL), b = pick(PALETTE_ALL.filter((c) => c !== a))
    const kind = Math.floor(rnd() * 4), s = pick([4, 6, 8, 12])
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const on = kind === 0 ? ((Math.floor(x / s) + Math.floor(y / s)) & 1) === 0
        : kind === 1 ? Math.floor(x / s) % 2 === 0
        : kind === 2 ? Math.floor((x + y) / s) % 2 === 0
        : ((x % (2 * s)) - s) ** 2 + ((y % (2 * s)) - s) ** 2 < (s * 0.6) ** 2
      p.set(x, y, on ? a : b)
    }
  }

  const paintScene = (r: Rect) => {
    const v = Math.floor(rnd() * 3)
    if (v === 0) { // hillside + sun
      p.rect(r.x, r.y, r.w, r.h, C.lightBlue)
      p.disc(r.x + r.w - Math.floor(r.w * 0.25), r.y + Math.floor(r.h * 0.3), Math.floor(Math.min(r.w, r.h) * 0.14), C.yellow)
      for (let x = r.x; x < r.x + r.w; x++) {
        const top = r.y + Math.floor(r.h * 0.6) + Math.round(r.h * 0.12 * Math.sin((x - r.x) / 30) + r.h * 0.05 * Math.sin((x - r.x) / 9))
        for (let y = top; y < r.y + r.h; y++) p.set(x, y, y < top + 4 ? C.lime : C.green)
      }
    } else if (v === 1) { // night sky
      p.gradient(r.x, r.y, r.w, r.h, [C.black, C.darkBlue, C.indigo], true)
      for (let i = 0; i < (r.w * r.h) / 400; i++) p.set(r.x + Math.floor(rnd() * r.w), r.y + Math.floor(rnd() * r.h), rnd() < 0.8 ? C.white : C.yellow)
      p.bitmap(SPRITES.moon!, r.x + r.w - 8 * 6 - 8, r.y + 8, 6, [C.cream])
    } else { // sea
      p.gradient(r.x, r.y, r.w, r.h, [C.cyan, C.blue, C.darkBlue], true)
      for (let y = r.y + 10; y < r.y + r.h; y += 14) for (let x = r.x; x < r.x + r.w; x++) if (Math.sin((x + y) / 6) > 0.6) p.set(x, y + Math.round(2 * Math.sin(x / 10)), C.white)
      const s = 3
      for (let i = 0; i < 4; i++) p.bitmap(SPRITES.fish!, r.x + 10 + Math.floor(rnd() * (r.w - 40)), r.y + 10 + Math.floor(rnd() * (r.h - 40)), s, [pick([C.orange, C.yellow, C.pink]), C.black])
    }
    p.frame(r.x, r.y, r.w, r.h, 2, C.black)
  }

  for (const r of rects) {
    const roll = rnd()
    if (roll < 0.24) paintFlag(r, pick(FLAGS))
    else if (roll < 0.40) paintBanner(r)
    else if (roll < 0.56) paintMosaic(r)
    else if (roll < 0.68) paintSolid(r)
    else if (roll < 0.80) paintGradient(r)
    else if (roll < 0.91) paintPattern(r)
    else if (roll < 0.97) paintScene(r)
    // else: left white, an unclaimed patch
  }

  // ---- 2. Landmarks on top. ----
  // The blue corner: fuzzy-edged blue field in the top-right.
  for (let y = 0; y < 260; y++) for (let x = W - 380; x < W; x++) {
    const edge = Math.min(x - (W - 380), 260 - y)
    if (edge > 50 || rnd() < edge / 50) p.set(x, y, rnd() < 0.07 ? C.lightBlue : C.blue)
  }
  p.text('BLUE CORNER', W - 340, 40, 4, C.white)

  // Rainbow road: a diagonal band across everything.
  const stripes = [C.red, C.orange, C.yellow, C.green, C.blue, C.indigo, C.purple]
  const bandW = 12
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = x + y * (W / H) - W * 0.66
    if (t >= 0 && t < bandW * stripes.length) p.set(x, y, stripes[Math.floor(t / bandW)]!)
  }

  // The Void: a black blob with tendrils eating the bottom-left, plus stray voidlets elsewhere.
  for (let y = H - 340; y < H; y++) for (let x = 0; x < 460; x++) {
    const nx = x / 460, ny = (y - (H - 340)) / 340
    const d = Math.hypot(nx, 1 - ny) + 0.2 * Math.sin(nx * 13 + seed) * Math.sin(ny * 9) + 0.06 * Math.sin(nx * 41) * Math.sin(ny * 37)
    if (d < 0.86 || (d < 1.0 && rnd() < (1.0 - d) / 0.14)) p.set(x, y, rnd() < 0.04 ? C.darkPurple : C.black)
  }
  for (let i = 0; i < 14; i++) {
    const cx = Math.floor(rnd() * W), cy = Math.floor(rnd() * H), r = 10 + Math.floor(rnd() * 26)
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
      const d = Math.hypot(j, k) / r + 0.25 * Math.sin(j * 0.7) * Math.sin(k * 0.5)
      if (d < 0.9) p.set(cx + k, cy + j, C.black)
    }
  }
  p.text('THE VOID', 24, H - 60, 4, C.darkPurple)

  // A text wall.
  const wall: Rect = { x: 1180, y: 640, w: 560, h: 210 }
  p.rect(wall.x, wall.y, wall.w, wall.h, C.black)
  p.frame(wall.x, wall.y, wall.w, wall.h, 3, C.white)
  const lines = ['THE CANVAS WAS BLANK.', 'THEN EVERYONE CAME.', 'THE VOID ATE A CORNER.', 'A RAINBOW CROSSED IT ALL.', 'FLAGS ROSE AND FELL.', 'WE MADE IT TOGETHER.']
  lines.forEach((l, i) => p.text(l, wall.x + 20, wall.y + 18 + i * 30, 3, i % 2 ? C.yellow : C.white))

  // The wordmark on a plate, dead center.
  const scale = 14
  const label = 'PLACE'
  const tw = Painter.textWidth(label, scale)
  const plate: Rect = { x: Math.round((W - tw) / 2) - 40, y: Math.round(H / 2 - 3.5 * scale) - 60, w: tw + 80, h: 7 * scale + 110 }
  p.rect(plate.x, plate.y, plate.w, plate.h, C.white)
  p.frame(plate.x, plate.y, plate.w, plate.h, 4, C.black)
  p.text(label, Math.round((W - tw) / 2), plate.y + 24, scale, C.orange, C.black)
  const tag = 'MADE TOGETHER'
  p.text(tag, Math.round((W - Painter.textWidth(tag, 4)) / 2), plate.y + 7 * scale + 46, 4, C.darkGray)

  // Hearts and stars sprinkled over everything.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(rnd() * (W - 40)), y = Math.floor(rnd() * (H - 40))
    p.bitmap(rnd() < 0.6 ? SPRITES.heart! : SPRITES.star!, x, y, 3, [rnd() < 0.5 ? C.pink : rnd() < 0.5 ? C.red : C.yellow])
  }

  // Stray pixels, the way a live canvas always looks.
  for (let i = 0; i < 6000; i++) p.set(Math.floor(rnd() * W), Math.floor(rnd() * H), Math.floor(rnd() * 32))
}
