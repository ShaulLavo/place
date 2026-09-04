// Print dimensions and the dominant colors of an image. Usage: bun scripts/imginfo.ts <file>
import sharp from 'sharp'
const f = process.argv[2]!
const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true })
const set = new Map<number, number>()
for (let i = 0; i < data.length; i += info.channels) { const k = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!; set.set(k, (set.get(k) ?? 0) + 1) }
console.log(f, info.width + 'x' + info.height, 'colors:', set.size, 'top:', [...set.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => '#' + k.toString(16).padStart(6, '0') + ':' + n).join(' '))
