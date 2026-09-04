# Place — a 1:1 r/place clone

Status: BUILT (v1 complete 2026-09-04). This document is the architecture reference; see README.md for usage.

## Goals

- One shared canvas, millions of pixels, edited by many browsers at once.
- Rendering must be butter-smooth: 60 fps pan/zoom at every zoom level, crisp
  pixels when zoomed in, no shimmer/aliasing when zoomed out, no seams.
- Click a pixel → pick a color → place. Cooldown between placements (0 for now).
- Every open browser sees a placement within ~100 ms.
- Survive restarts (canvas persisted), survive reconnects (no lost pixels).
- End-to-end type safety for everything that isn't a raw pixel stream.

## Stack (v2)

| Layer          | Choice                                            | Why                                                                                                   |
| -------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Language       | TypeScript everywhere                             | One language; the server's route types are the client's API types.                                    |
| Server runtime | **Bun 1.4**                                       | Native WS server (uWebSockets), pub/sub, backpressure.                                                |
| Server fw      | **Elysia 1.4.30** + **Eden Treaty 1.4.9**         | Typed REST with zero codegen. WS route passes binary through untouched. (Details below.)               |
| Client build   | **Vite 8** + `@solidjs/vite-plugin`               | Required by Solid 2. Client-only mode, no "start mode".                                                |
| UI             | **Solid 2.0 RC** (`solid-js@2.0.0-rc.6`)          | It's RC, not beta: API frozen. Chrome is ~6 components so RC churn risk is contained. Pin exact versions. |
| Renderer       | **WebGPU** first, **WebGL2** fallback, hand-written | One textured triangle per backend, ~200 lines each. No library earns its 200 KB here.               |
| Transport      | Typed JSON REST (Eden) + raw binary WebSocket     | 4 bytes per pixel update. Snapshot over HTTP with brotli.                                             |
| Persistence    | Flat binary snapshot + append-only log            | Snapshot every 10 s if dirty. Log gives full history / timelapse for free.                            |
| Tests          | `bun test` + WS load generator                    | Protocol/cooldown unit tests; load script for smoothness under thousands of pixels/sec.               |
| Deploy         | Single Bun process, Dockerfile                    | Redis pub/sub is the documented path to multi-process; not v1.                                        |

Repo layout (single package):

```
place/
  src/
    shared/    protocol.ts (u32 packing, WS frame types), palette.ts, config.ts
    server/    app.ts (Elysia app, exported `App` type), canvas.ts, store.ts, cooldown.ts, index.ts
    client/    main.tsx, api.ts (Eden), ws.ts (binary socket), camera.ts, input.ts,
               render/ (renderer.ts interface, webgpu.ts, webgl2.ts, shaders), ui/ (Solid components)
  scripts/     loadtest.ts
  index.html, vite.config.ts, package.json, Dockerfile
```

## Type safety: Elysia + Eden, and where the bytes go

Research findings (verified against elysia 1.4.30 source, run on Bun 1.4):

- **Incoming binary is untouched.** Elysia only JSON-parses *string* messages. A binary
  frame arrives in `message()` as a Node `Buffer`, bytes intact. If no `body` schema is
  declared, no validator runs at all. So: declare no schema on the WS route.
- **Outgoing binary has a footgun.** `ws.send(uint8array)` and `ws.publish(topic, uint8array)`
  JSON-stringify the array into a *text* frame (`{"0":1,"1":2,…}`). Only `Buffer` bypasses it.
  Rule: always use `ws.sendBinary()`, `ws.publishBinary()`, or `app.server.publish()` (Bun-native),
  and never return a value from `message()`. This is enforced by a tiny wrapper so nobody
  can call the wrong one.
- **Eden's WS client is JSON-only** and mangles binary both ways. We don't use it. The
  socket client is ~30 lines over native `WebSocket` with `binaryType = 'arraybuffer'`.
- **Eden for REST is perfect.** `/api/config`, `/api/place` (ack, cooldown), `/api/me`
  are inferred end-to-end from the server's route definitions. No schema duplication.
- **Snapshot:** typed as `Response` in Eden but arrives as `ArrayBuffer`; we fetch it with
  plain `fetch` and skip the cast dance. Brotli is decoded by the browser transparently.
- **Overhead:** Elysia adds ~0.2 µs per WS message over raw `Bun.serve`. Fan-out goes
  through Bun's native pub/sub, so broadcast cost is unchanged. Irrelevant at our rates.
- **Bun 1.4 notes:** be on elysia ≥ 1.4.30. `server.publish()` now returns 0/-1 on
  backpressure instead of byte count; handle that. Static `Response` routes with AOT
  have a known bug; we use function handlers.

So the "typed contract" for pixels is a shared `protocol.ts` (the u32 packing functions +
frame type enum) imported by both sides, and Eden types everything else.

## Renderer: WebGPU first, WebGL2 fallback

**Support reality (Sept 2026, caniuse ≈ 87 % global):** Chrome/Edge desktop yes, Chrome
Android on modern GPUs yes, Safari 26 yes (macOS 26+ / iOS 26), Firefox on Windows and
Apple Silicon yes. **Not** on: Firefox Linux (Nightly only), Chrome on AMD Linux, older
Android. The WebGL2 fallback is a first-class path, not a stub.

**Shared interface:**

```ts
interface Renderer {
  init(canvas: HTMLCanvasElement): Promise<void>
  upload(rect: Rect, rgba: Uint8Array): void   // dirty sub-rect
  draw(view: View, overlay: Overlay): void     // camera + hover/selected/grid uniforms
  resize(w: number, h: number, dpr: number): void
  destroy(): void
}
```

Selection: `navigator.gpu?.requestAdapter()`; null or `isFallbackAdapter` (software) → WebGL2.
`?renderer=webgl2` query param forces the fallback for testing/support. WebGPU device loss →
re-request adapter + device, re-upload from the CPU-side pixel buffer (we have it anyway);
if that fails, hot-swap to WebGL2. WebGL2 context loss handled the same way.

**Both backends do the same three things per frame:**
1. Sub-rect upload of the coalesced dirty rectangle (WebGPU `queue.writeTexture` with an
   origin; WebGL2 `texSubImage2D` with `UNPACK_ROW_LENGTH`). No 256-byte alignment rule
   applies to `writeTexture`.
2. Mip regeneration, *only on dirty frames*:
   - **WebGPU has no `generateMipmap`.** We run one scissored render pass per level
     (11 levels for 2000²), `loadOp: 'load'`, sampling level N-1 with a linear sampler into
     level N, scissor = halved-and-padded dirty rect. Views and bind groups are cached once.
     A dirty 1×1 pixel costs 10 tiny passes; a full-canvas snapshot load costs one full chain.
   - **WebGL2:** `generateMipmap`. Full chain each dirty frame; ~1 ms at 2000², fine.
3. One draw: full-screen triangle, fragment shader maps screen → canvas coords via the
   camera and samples with `mag: nearest, min: linear, mipmap: linear`. Crisp when
   zoomed in, pre-averaged when zoomed out, transition at zoom = 1 is automatic.

Shaders are WGSL and GLSL ES 3.0 versions of the same ~40 lines (sample + grid + outlines).

**Camera** (unchanged from v1): `{ cx, cy, log2zoom }`, eased toward a target each frame;
zoom about the cursor for wheel / pinch / double-tap; drag pan with inertia; at zoom ≥ 1
snap so canvas pixel edges land on device pixel edges; HiDPI-aware; clamped to the canvas.

**Overlays in the shader:** grid past zoom ≈ 8, hover outline, selected outline with
chosen-color preview. No DOM on top of the canvas.

## UI: Solid 2.0 RC, and the "signals on the server" question

**What's true about Solid 2 today (verified):**
- `solid-js@2.0.0-rc.6` (2026-09-02). RC since Aug 12; "API frozen but not bug-free".
  Patch releases every 2–5 days. Router, meta, vite-plugin, testing-library are all still
  on `next`/`beta` tags. Install via the official `solid-v2/*` templates.
- **SolidStart is retired** (RC post: "instead of shipping a hollow 3.0, we're retiring it").
  Replaced by "start mode" in `@solidjs/vite-plugin` (`solid({ start: true, ssr: true,
  serverFunctions: true })`). Start mode explicitly **dropped WebSockets**; you bring your own server.
- **There is no bidirectional "server signal".** What exists:
  - `live()` server functions: a `"use server"` async generator whose yields stream to the
    client as successive values of a reactive read, over a long-lived **HTTP** response
    (seroval-encoded). One-directional, server → client. Writes are ordinary server
    function POSTs / `action()`. No pub/sub built in.
  - Reactive **server components** behind an experimental flag, "full announcement after
    2.0 stable". Undocumented patch protocol.
  - The "set a signal on the client, it updates on the server" picture is Ryan's
    hypothetical "Server Signals" note (marked hypothetical) and an unpublished,
    Solid-1-era experiment (`solid-socket`). Not shipping.

**Decision:** use Solid 2 RC for the UI **client-only**, no start mode, pinned exact
versions. Elysia stays the only server. Reasons: we need a binary WS server that start mode
can't host; running Solid's server-function runtime *inside* Elysia is possible
(`handleRequest` export) but stacks two RC-era runtimes for a cooldown timer.

**We still get the thing you're after, without the magic:** the server owns the small
state (cooldown deadline, online count, your last placement) and pushes it as tiny JSON
frames on the same WebSocket. The client feeds them into Solid signals/stores; components
just read `cooldownUntil()` and `online()`. Pixels bypass Solid entirely (WS → typed
array → renderer), which is what keeps 60 fps.

**Optional later experiment (Phase 8):** mount Solid start-mode `handleRequest` inside
Elysia and re-implement presence/cooldown as `live()` reads, to compare. Isolated, deletable.

## Canvas parameters (all in `shared/config.ts`)

| Param    | Default                      | Note                                                      |
| -------- | ---------------------------- | --------------------------------------------------------- |
| Size     | 2000 × 2000                  | 4 M pixels, the real 2022 canvas size. |
| Palette  | 32 colors                    | The 2022 r/place palette.                                 |
| Cooldown | **0** (env `COOLDOWN_MS`)    | Server-authoritative when non-zero.                       |
| Storage  | 1 byte/pixel (palette index) | 2 MB on server and client; +8 MB RGBA on the client.     |

## Sync protocol

A pixel update is one `u32`: `(y*W + x) << 5 | color` (22 bits index, 5 bits color).

**Boot:**
1. `api.config.get()` (Eden, typed) → `{ w, h, palette, cooldownMs, serverTime }`.
2. Open `WS /ws` (cookie id assigned on upgrade). Server sends `hello { seq }`.
3. `fetch('/api/canvas')` → raw indices, brotli, header `X-Seq: N`.
4. Apply buffered WS updates with `seq > N`. Consistent from here on.

**Steady state:**
- Client → server: binary `u32` per placement. Server validates bounds/color/cooldown,
  applies, and sends a JSON ack `{ ok, seq, nextAllowedAt } | { err }`.
- Server coalesces 50 ms of placements and `server.publish('board', frame)`:
  `[type:u8][firstSeq:u32][u32 × n]`.
- Small state (`{ online }`, `{ cooldownUntil }`) as JSON text frames, low frequency.

**Reconnect:** `?since=seq`; server replays from a ring buffer of the last ~1 M updates or
answers `resync` → client refetches the snapshot. Exponential backoff.

**Identity:** anonymous. Random id in an httpOnly cookie set on first request; cooldown
keyed by cookie id + IP. Real accounts are a later add-on keyed by user id.

## Persistence

- `data/canvas.bin`: the 4 MB index array, rewritten atomically every 10 s if dirty.
- `data/log.bin`: append-only `[u64 ts][u32 pixel][u32 userHash]`, fsync on an interval.
- Boot: load snapshot, replay log entries newer than it.

## Scaling notes (not v1)

- One Bun process handles tens of thousands of sockets; outbound bandwidth is the limit.
- Multi-process: Redis bitfield for the canvas + Redis pub/sub replacing Bun's. Protocol unchanged.
- Snapshot behind a CDN with a short TTL.

## Build order

1. Scaffold: Bun + Elysia + Vite 8 + Solid 2 RC + shared config/palette/protocol with tests.
2. Renderer interface + **WebGL2 backend first** (simplest, universal) + camera + input
   against a random local canvas. Get the feel perfect.
3. WebGPU backend to the same interface, including scissored mip regen and device-loss
   recovery. Auto-select, `?renderer=` override.
4. Server: Elysia app, state, snapshot route, binary WS broadcast, place/ack, cooldown.
5. Client networking: Eden for REST, hand-written binary socket, boot sequence, reconnect.
6. Solid UI: palette bar, place button, cooldown, coords, online count, URL hash.
7. Persistence + Dockerfile.
8. Load test script and profiling pass. (Then, optionally, the `live()` experiment.)

## Decisions confirmed

- Canvas 2000×2000. Anonymous cookie identity. Cooldown 0. Solid 2 RC for UI, client-only.
- Elysia + Eden for REST, raw binary WS alongside. WebGPU first, WebGL2 fallback, both hand-written.

## Open questions

1. OK to use Solid 2 RC despite the patch churn? (Alternative: vanilla DOM, ~same size.)
2. OK to skip start mode / `live()` for v1 and revisit as an isolated experiment?

## UX revision (2026-09-04)

Surveyed Reddit's 2022/2023 embeds (archived bundles), Pxls, rplace.live, PixelPlanet, Fediverse Canvas, wplace, pixelcanvas.io, OWOP, dynastic/place. The genre converged on: color first then click places (persistent color), a ghost preview of the color on the hovered pixel with a screen-pixel outline, auto-zoom on far-out clicks instead of refusing, an always-visible bottom palette with 30–36 px swatches and a scaled selection, coordinates of hover with center fallback that copy a link, WASD/QE keys, an eyedropper, a pulse on placement, zoom-gated thin grid lines, a mid-gray table outside the canvas. Reddit's confirm flow only feels right with a 5-minute cooldown. Place now follows the immediate model on desktop and Reddit's tap → reticle → Place on touch. Not yet built from that list: template overlays, pixel history (needs identity), sounds, undo window, pixel stacking.
