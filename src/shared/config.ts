// Canvas parameters shared by client and server.

export const CANVAS_W = 2000
export const CANVAS_H = 2000
export const PIXEL_COUNT = CANVAS_W * CANVAS_H

/** Bits reserved for the color index inside a packed u32 update. */
export const COLOR_BITS = 5
export const COLOR_MASK = (1 << COLOR_BITS) - 1

/** Zoom range in log2(device px per canvas px). MIN is computed per viewport. */
export const MAX_LOG_ZOOM = 6 // 64x

/** Default color index for an empty canvas (white in the 2022 palette). */
export const BLANK_COLOR = 31

/** Server coalesces placements for this long before broadcasting a frame. */
export const BROADCAST_INTERVAL_MS = 50

/** Ring buffer of recent updates kept for reconnect replay. Power of two. */
export const RING_SIZE = 1 << 20
