// The 32-color r/place 2022 palette.

export const PALETTE_HEX = [
  '#6D001A', '#BE0039', '#FF4500', '#FFA800', '#FFD635', '#FFF8B8', '#00A368', '#00CC78',
  '#7EED56', '#00756F', '#009EAA', '#00CCC0', '#2450A4', '#3690EA', '#51E9F4', '#493AC1',
  '#6A5CFF', '#94B3FF', '#811E9F', '#B44AC0', '#E4ABFF', '#DE107F', '#FF3881', '#FF99AA',
  '#6D482F', '#9C6926', '#FFB470', '#000000', '#515252', '#898D90', '#D4D7D9', '#FFFFFF',
] as const

export const PALETTE_SIZE = PALETTE_HEX.length

/** RGBA bytes, 4 per color, in palette order. */
export const PALETTE_RGBA: Uint8Array = (() => {
  const out = new Uint8Array(PALETTE_SIZE * 4)
  PALETTE_HEX.forEach((hex, i) => {
    out[i * 4] = parseInt(hex.slice(1, 3), 16)
    out[i * 4 + 1] = parseInt(hex.slice(3, 5), 16)
    out[i * 4 + 2] = parseInt(hex.slice(5, 7), 16)
    out[i * 4 + 3] = 255
  })
  return out
})()

export function paletteRgb01(i: number): [number, number, number] {
  const o = i * 4
  return [PALETTE_RGBA[o]! / 255, PALETTE_RGBA[o + 1]! / 255, PALETTE_RGBA[o + 2]! / 255]
}
