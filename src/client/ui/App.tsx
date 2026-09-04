import { Show } from 'solid-js'
import { Hud } from './Hud'
import { PaletteBar } from './PaletteBar'
import { loading, toast } from '../state'

export function App() {
  return (
    <>
      <Hud />
      <PaletteBar />
      <Show when={toast()}>{(msg) => <div class="toast" role="status">{msg()}</div>}</Show>
      <Show when={loading()}>{(msg) => <div class="loading" role="status"><div class="spinner" />{msg()}</div>}</Show>
    </>
  )
}
