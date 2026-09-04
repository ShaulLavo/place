# Place — r/place clone

Read PLAN.md first; it holds the architecture and the verified reasons behind each choice.

## Commands
- `bun run dev` — Vite (:5173, proxies /api + /ws) and the API server (:3000) together.
- `bun test` / `bun run typecheck` / `bun run build` / `bun run start` (prod, serves dist/).
- `bun scripts/smoke.ts [url] [outDir]` — Chromium end-to-end check with GPU readback and screenshots; `HEADED=1` for hardware WebGPU.
- `bun scripts/loadtest.ts [ws] [clients] [px/s] [seconds]`.

## Rules that are easy to get wrong
- Elysia WS: never `ws.send(typedArray)` or return from `message()`; use `sendBinary` / `server.publish`. No `body` schema on the WS route.
- Eden's WS client is JSON-only; the pixel socket is hand-written in `src/client/net.ts`.
- Pixels never go through Solid signals. Only small UI state does (`src/client/state.ts`).
- Both shaders (`render/webgl2.ts` GLSL, `render/webgpu.ts` WGSL) must stay in step; the uniform layout is in `render/renderer.ts`.
- `?renderer=webgl2` forces the fallback; `?renderer=webgpu` also accepts a software adapter (SwiftShader) so headless tests can exercise WGSL.
- Solid 2 RC: `createEffect(compute, apply)`, `class={[...]}` instead of `classList`, `onSettled` instead of `onMount`. Cheatsheet: `node_modules/solid-js/CHEATSHEET.md`.
- Headless Chromium on this machine exposes only a software WebGPU adapter; hardware WebGPU needs a headed browser.
- Visual style is Reddit 2023's pixel chrome (square, 3px black borders, hard shadows, #333 table); the user rejected rounded pills. Values come from the archived garlic-bread bundle (see PLAN.md).
- UX model (from the r/place-clone survey, see PLAN.md notes): pick a color once, then every click or tap paints; fly-in when too far out; ghost preview drawn in the shader; docked palette. No pick-a-pixel or confirm step anywhere, the user rejected it.
- Seeding only runs on a fresh data dir; re-seeding means moving `data/` aside and restarting `place.service`. Default seed is the real 2022 canvas from `art/place2022.idx.gz` (`src/server/art.ts`); `src/server/seed.ts` is the procedural fallback. Wikimedia's "final canvas" PNGs are blank placeholders; the placeAtlas GitHub repos hold the real ones.

## Deployment on this machine
- `place.service` (systemd user unit, `~/.config/systemd/user/place.service`) runs the production server on :3000 from this directory; `systemctl --user restart place` after server changes.
- `mesh serve omarchy 3000 --at /place` publishes it at https://omarchy.mesh.shaulavo.dev/place (tailnet only). The proxy strips `/place`, so the client must be built with `bun run build:mesh` (BASE_PATH=/place/). Static files are read per request; no restart needed after a client build.
