import { For, Show } from 'solid-js'
import { PALETTE_HEX } from '../../shared/palette'
import { color, cooldownUntil, now, serverOffset, setColor, touch } from '../state'

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Always-docked palette. Pick a color, then every click or tap paints. */
export function PaletteBar() {
  const remaining = () => Math.max(0, cooldownUntil() - (now() + serverOffset))
  const cooling = () => remaining() > 0
  const status = () => {
    if (cooling()) return `Next pixel in ${fmt(remaining())}`
    if (color() === null) return 'Pick a color'
    return touch ? 'Tap a pixel to paint' : 'Click a pixel to paint'
  }
  return (
    <div class="bar" role="toolbar" aria-label="Palette">
      <div class="bar-status">
        <Show when={color() !== null}>
          <span class="chip" style={{ background: PALETTE_HEX[color()!] }} />
        </Show>
        <span>{status()}</span>
      </div>
      <div class="swatches" role="radiogroup" aria-label="Colors">
        <For each={PALETTE_HEX}>
          {(hex, i) => (
            <button
              class="swatch"
              style={{ background: hex }}
              role="radio"
              aria-label={hex}
              aria-checked={color() === i() ? 'true' : 'false'}
              onClick={(e) => { setColor(color() === i() ? null : i()); (e.currentTarget as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' }) }}
            />
          )}
        </For>
      </div>
      <div class="bar-end" />
    </div>
  )
}
