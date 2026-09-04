// Bake source images into palette-indexed pixel art for the seed.
// Usage: bun scripts/bake-art.ts            (bakes every entry in art/manifest.json)
// Each entry: { name, src (URL or art/src path), w, h?, dither?: boolean, license }
// Output: src/server/art/<name>.ts exporting { w, h, data } with data as base64 palette indices.
import sharp from 'sharp'
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PALETTE_RGBA, PALETTE_SIZE } from '../src/shared/palette'

interface Entry { name: string; src: string; w: number; h?: number; dither?: boolean; license: string; /** 'ts' (default, small sprites) or 'gz' (raw indices, gzipped, for full canvases) */ out?: 'ts' | 'gz' }
const root = new URL('..', import.meta.url).pathname
const manifest: Entry[] = JSON.parse(readFileSync(join(root, 'art/manifest.json'), 'utf8'))
mkdirSync(join(root, 'art/cache'), { recursive: true })
mkdirSync(join(root, 'src/server/art'), { recursive: true })

// Perceptual-ish nearest color: weighted RGB distance in linear-ish space.
const pal: [number, number, number][] = Array.from({ length: PALETTE_SIZE }, (_, i) => [PALETTE_RGBA[i * 4]!, PALETTE_RGBA[i * 4 + 1]!, PALETTE_RGBA[i * 4 + 2]!])
function nearest(r: number, g: number, b: number): number {
  let best = 0, bd = Infinity
  for (let i = 0; i < pal.length; i++) {
    const [pr, pg, pb] = pal[i]!
    const rm = (r + pr) / 2
    const dr = r - pr, dg = g - pg, db = b - pb
    const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db
    if (d < bd) { bd = d; best = i }
  }
  return best
}

async function fetchSrc(e: Entry): Promise<Buffer> {
  if (!/^https?:/.test(e.src)) return readFileSync(join(root, e.src))
  const cache = join(root, 'art/cache', e.name + '.bin')
  if (existsSync(cache)) return readFileSync(cache)
  const r = await fetch(e.src, { headers: { 'user-agent': 'place-seed-bake/1.0 (https://github.com/; contact: local)' } })
  if (!r.ok) throw new Error(`${e.name}: ${r.status} ${e.src}`)
  const buf = Buffer.from(await r.arrayBuffer())
  writeFileSync(cache, buf)
  return buf
}

const only = process.argv.slice(2)
for (const e of manifest) {
  if (only.length && !only.includes(e.name)) continue
  const src = await fetchSrc(e)
  let img = sharp(src).flatten({ background: '#ffffff' })
  const meta = await img.metadata()
  const w = e.w, h = e.h ?? Math.round((meta.height! / meta.width!) * e.w)
  const { data } = await img.resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  // Floyd–Steinberg in float RGB.
  const px = new Float32Array(w * h * 3)
  for (let i = 0; i < w * h * 3; i++) px[i] = data[i]!
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 3
    const r = Math.min(255, Math.max(0, px[o]!)), g = Math.min(255, Math.max(0, px[o + 1]!)), b = Math.min(255, Math.max(0, px[o + 2]!))
    const idx = nearest(r, g, b)
    out[y * w + x] = idx
    if (e.dither === false) continue
    const [pr, pg, pb] = pal[idx]!
    const er = r - pr, eg = g - pg, eb = b - pb
    const spread = (dx: number, dy: number, k: number) => {
      const xx = x + dx, yy = y + dy
      if (xx < 0 || xx >= w || yy >= h) return
      const q = (yy * w + xx) * 3
      px[q] = px[q]! + er * k; px[q + 1] = px[q + 1]! + eg * k; px[q + 2] = px[q + 2]! + eb * k
    }
    spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16)
  }
  if (e.out === 'gz') {
    // 8-byte header [w:u32][h:u32] + indices, gzipped. Loaded by src/server/art.ts.
    const buf = new Uint8Array(8 + out.length)
    new DataView(buf.buffer).setUint32(0, w, true)
    new DataView(buf.buffer).setUint32(4, h, true)
    buf.set(out, 8)
    const gz = Bun.gzipSync(buf, { level: 9 })
    writeFileSync(join(root, 'art', e.name + '.idx.gz'), gz)
    console.log(`${e.name}: ${w}x${h} → art/${e.name}.idx.gz (${Math.round(gz.length / 1024)} KB) // ${e.license}`)
    continue
  }
  const b64 = Buffer.from(out).toString('base64')
  writeFileSync(join(root, 'src/server/art', e.name + '.ts'),
    `// Baked by scripts/bake-art.ts from ${e.src}\n// License: ${e.license}\nexport default { w: ${w}, h: ${h}, data: '${b64}' }\n`)
  console.log(`${e.name}: ${w}x${h} → src/server/art/${e.name}.ts (${Math.round(b64.length / 1024)} KB)`)
}
