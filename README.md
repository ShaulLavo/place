# Place

A 1:1 r/place clone. 2000×2000 canvas, 32-color 2022 palette, WebGPU renderer with
WebGL2 fallback, Bun + Elysia server, binary WebSocket sync, Solid 2 UI.
Architecture and the reasoning behind it: [PLAN.md](PLAN.md).

## Run

```sh
bun install
bun run dev          # Vite on :5173 (proxies /api and /ws) + API server on :3000
```

Open http://localhost:5173. Production:

```sh
bun run build        # client → dist/
bun run start        # serves dist/ + API on :3000
```

Env: `PORT` (3000), `COOLDOWN_MS` (0), `DATA_DIR` (./data). To mount behind a route prefix, build with `BASE_PATH=/place/ bun run build`; the client derives its API and socket URLs from where it was loaded. Docker: `docker build -t place . && docker run -p 3000:3000 -v place-data:/data place`.

## Scripts

| Command                                   | What                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `bun test`                                | Protocol, board, cooldown, store, and socket integration tests.      |
| `bun run typecheck`                       | `tsc` over client, server, and scripts.                              |
| `bun run build:mesh`                      | Client build mounted at `/place/` for the mesh route.                |
| `bun scripts/loadtest.ts [ws] [n] [px/s] [s]` | N fake clients placing pixels; prints ack RTT and broadcast latency. |
| `bun scripts/smoke.ts [url] [outDir]`     | Chromium end-to-end: both renderers, zoom, place, cross-page sync, GPU readback, screenshots. `HEADED=1` opens a real window for hardware WebGPU. |

## Using it

Pick a color in the bottom bar, then click or tap pixels to paint them. Clicking while zoomed far out flies in on that pixel instead of painting (only when a color is selected; there is no double-click zoom). The chosen color stays selected so you can keep painting.

Keys: `WASD`/arrows pan, `Q`/`E` or `-`/`+` zoom, `C` or middle-click picks the color under the pointer (eyedropper), `Esc` clears the color. Clicking the coordinates pill copies a link to the current view.

Query params: `?renderer=webgl2` forces the fallback, `?debug` shows the renderer and update rate. URL hash `#x,y,zoom` is the shareable view. A fresh data directory is seeded with the real r/place 2022 final canvas (`art/place2022.idx.gz`, baked from the placeAtlas archive). `SEED=place2023` uses the 2023 canvas cropped to fit, `SEED=dense` the procedural artwork, `SEED=0` a blank canvas. The seed only applies when no snapshot exists, so to re-seed stop the server and move `data/` aside. `bun scripts/bake-art.ts` rebuilds the baked canvases from `art/manifest.json` (sources cached in `art/cache/`).

## Layout

```
src/shared   config, palette, wire protocol (u32-packed pixels)
src/server   Elysia app (typed REST + binary WS), board, cooldown, store (snapshot + log)
src/client   board mirror, camera, input, render/{webgpu,webgl2}, net (Eden + socket), ui (Solid 2)
```
