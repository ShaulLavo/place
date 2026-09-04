import { Show } from 'solid-js'
import { actions, center, debug, hover, online, rate, rendererName, status, zoom } from '../state'

const Icon = (p: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={p.d} />
  </svg>
)

const fmtZoom = (z: number) => (z >= 10 ? z.toFixed(0) : z >= 1 ? z.toFixed(1) : z.toFixed(2)) + '×'

export function Hud() {
  const pos = () => hover() ?? center()
  const presence = () => {
    switch (status()) {
      case 'online': return `${online()} online`
      case 'connecting': return 'Connecting'
      case 'reconnecting': return 'Reconnecting'
      case 'offline': return 'Offline'
    }
  }
  return (
    <>
      <div class="pill zoomctl" role="group" aria-label="Zoom">
        <button class="iconbtn" aria-label="Zoom out" onClick={actions.zoomOut}><Icon d="M5 12h14" /></button>
        <span class="zoom">{fmtZoom(zoom())}</span>
        <button class="iconbtn" aria-label="Zoom in" onClick={actions.zoomIn}><Icon d="M12 5v14M5 12h14" /></button>
        <button class="iconbtn" aria-label="Fit canvas" title="Fit canvas" onClick={actions.fit}><Icon d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></button>
      </div>
      <button class="pill coords" title="Copy link to this view" onClick={actions.share}>({pos()[0]}, {pos()[1]})</button>
      <div class="pill presence" role="status">
        <span class={['dot', status()]} />
        <span>{presence()}</span>
        <button class="iconbtn" aria-label="Copy link to this view" title="Copy link" onClick={actions.share}><Icon d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></button>
      </div>
      <Show when={debug}>
        <div class="pill debug">
          <span>{rendererName()}</span>
          <span>{rate().toFixed(0)} px/s</span>
        </div>
      </Show>
    </>
  )
}
