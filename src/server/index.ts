import { resolve } from 'node:path'
import { createApp } from './app'
import { Cooldown } from './cooldown'
import { Store } from './store'
import { seedBoard } from './seed'
import { blit, loadArt } from './art'

const PORT = Number(process.env.PORT ?? 3000)
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS ?? 0)
const DATA_DIR = process.env.DATA_DIR ?? resolve(import.meta.dir, '../../data')
const STATIC_DIR = process.env.NODE_ENV === 'production' ? resolve(import.meta.dir, '../../dist') : undefined
const BASE_PATH = process.env.BASE_PATH ?? '/'

const store = new Store(DATA_DIR)
const board = store.load()
// SEED=0 disables; SEED=dense uses the procedural artwork; default is the real r/place 2022 final canvas
// (public domain, baked into art/place2022.idx.gz), centered and cropped to this canvas size.
if (store.fresh && process.env.SEED !== '0') {
  const art = process.env.SEED === 'dense' ? null : loadArt(process.env.SEED ?? 'place2022')
  if (art) {
    blit(board, art, Math.floor((board.w - art.w) / 2), Math.floor((board.h - art.h) / 2))
    console.log(`[place] fresh canvas seeded with ${process.env.SEED ?? 'place2022'} (${art.w}x${art.h})`)
  } else {
    seedBoard(board)
    console.log('[place] fresh canvas seeded with the procedural artwork')
  }
  store.snapshot(board, true)
}
const cooldown = new Cooldown(COOLDOWN_MS)
const server = createApp({ board, cooldown, store, staticDir: STATIC_DIR, basePath: BASE_PATH })

server.app.listen(PORT)
server.start()
store.start(board)

console.log(`[place] ${board.w}x${board.h} seq=${board.seq} cooldown=${COOLDOWN_MS}ms data=${DATA_DIR}`)
console.log(`[place] listening on http://localhost:${PORT}${STATIC_DIR ? ' (serving ' + STATIC_DIR + ')' : ' (API only; run vite for the client)'}`)

const shutdown = () => {
  console.log('[place] shutting down')
  server.stop()
  store.close(board)
  server.app.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
