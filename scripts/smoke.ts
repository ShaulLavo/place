// End-to-end smoke test: boots both renderers, zooms, places a pixel from one page,
// checks it shows up in the other, and reads rendered pixels back from the GPU.
// Usage: [HEADED=1] bun scripts/smoke.ts [baseUrl] [outDir]
// Headless Chromium only offers a software WebGPU adapter whose output cannot be read back;
// HEADED=1 opens a real window (hardware WebGPU) and attaches over CDP.
import { chromium, type Browser, type Page } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:3100'
const out = process.argv[3] ?? 'smoke-out'
mkdirSync(out, { recursive: true })

const CHROME = process.env.CHROME ?? '/usr/bin/chromium'
const GPU_FLAGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--use-angle=vulkan']
let child: ChildProcess | null = null
let browser: Browser
if (process.env.HEADED) {
  const port = 9500 + Math.floor(Math.random() * 400)
  child = spawn(CHROME, [`--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--window-size=1300,900',
    `--user-data-dir=${out}/chrome-profile`, ...GPU_FLAGS, 'about:blank'], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 2500))
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 })
} else {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [...GPU_FLAGS, '--use-gl=angle', '--no-sandbox'] })
}

const shot = (page: Page, file: string) =>
  page.screenshot({ path: `${out}/${file}.png`, timeout: process.env.HEADED ? 5000 : 30000 }).catch(() => console.log(`(screenshot ${file} skipped)`))

async function open(name: string, url: string): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`)
    else if (m.text().startsWith('[render]')) console.log(`${name}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
  await page.goto(url)
  await page.waitForSelector('.loading', { state: 'detached', timeout: 15000 })
  await page.waitForSelector('.dot.online', { timeout: 10000 })
  await page.evaluate(() => new Promise<void>((r) => { const t = setInterval(() => { if ((window as any).__place) { clearInterval(t); r() } }, 10) }))
  await page.waitForTimeout(300)
  await shot(page, `${name}-fit`)
  const renderer = await page.evaluate(() => (window as any).__place.renderer.name)
  console.log(`${name}: renderer=${renderer} url=${url}`)
  return { page, errors }
}

const a = await open('a', `${base}/?renderer=webgpu`)
const b = await open('b', `${base}/?renderer=webgl2`)

// Zoom in around the center with the wheel, several ticks, then let it settle.
const zoomIn = async (page: Page, ticks: number) => {
  await page.mouse.move(640, 400)
  for (let i = 0; i < ticks; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16) }
  await page.waitForTimeout(600)
}
await zoomIn(a.page, 12)
await zoomIn(b.page, 12)
await shot(a.page, 'a-zoomed')
await shot(b.page, 'b-zoomed')
console.log('a zoom:', await a.page.locator('.zoomctl .zoom').textContent(), ' b zoom:', await b.page.locator('.zoomctl .zoom').textContent())

// Measure frame pacing during a scripted zoom animation.
const pacing = await a.page.evaluate(() => new Promise<{ frames: number; worst: number; avg: number }>((resolve) => {
  const P = (window as any).__place
  const times: number[] = []
  let last = performance.now()
  let dir = 1
  const tick = (t: number) => {
    times.push(t - last); last = t
    if (times.length % 30 === 0) { dir = -dir; P.camera.zoomBy(dir * 2, 640, 400) }
    if (times.length < 240) requestAnimationFrame(tick)
    else resolve({ frames: times.length, worst: Math.max(...times.slice(1)), avg: times.slice(1).reduce((x, y) => x + y, 0) / (times.length - 1) })
  }
  P.camera.zoomBy(2, 640, 400)
  requestAnimationFrame(tick)
}))
console.log(`pacing (headless, uncapped): frames=${pacing.frames} avg=${pacing.avg.toFixed(2)}ms worst=${pacing.worst.toFixed(2)}ms`)

// Desktop flow: pick a color, then click a pixel (zoom is 6x, above the aim threshold).
await a.page.locator('.swatch').nth(2).click() // #FF4500
await a.page.mouse.move(640, 400)
await a.page.waitForTimeout(100)
const coords = (await a.page.locator('.coords').textContent())!
const m = /\((\d+), (\d+)\)/.exec(coords)!
const px = Number(m[1]), py = Number(m[2])
await a.page.mouse.click(640, 400)
await a.page.waitForTimeout(400)
await shot(a.page, 'a-placed')

const seenByB = await b.page.evaluate(([x, y]) => (window as any).__place.board.colorAt(x, y), [px, py] as [number, number])
const seenByA = await a.page.evaluate(([x, y]) => (window as any).__place.board.colorAt(x, y), [px, py] as [number, number])
const r = await fetch(`${base}/api/canvas`)
const server = new Uint8Array(await r.arrayBuffer())[py * 2000 + px]
console.log(`placed (${px},${py}) color 2 → a=${seenByA} b=${seenByB} server=${server}`)

// The docked bar with a color picked and the pointer over a pixel (WebGL2 so headless screenshots show the canvas).
await b.page.locator('.swatch').nth(13).click()
await b.page.mouse.move(640, 400)
await b.page.waitForTimeout(250)
await shot(b.page, 'b-bar')
await b.page.keyboard.press('Escape')
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  const m = await ctx.newPage()
  await m.goto(`${base}/?renderer=webgl2`)
  await m.waitForSelector('.loading', { state: 'detached', timeout: 15000 })
  await m.waitForSelector('.dot.online', { timeout: 10000 })
  await m.evaluate(() => new Promise<void>((r) => { const t = setInterval(() => { if ((window as any).__place) { clearInterval(t); r() } }, 10) }))
  await m.locator('.swatch').nth(6).tap()
  await m.touchscreen.tap(195, 350) // far out with a color: flies in on that pixel
  await m.waitForTimeout(700)
  const target = await m.evaluate(() => { const c = (window as any).__place.camera; return [Math.floor(c.cx), Math.floor(c.cy)] as [number, number] })
  await m.touchscreen.tap(195, 422) // viewport center = the flown-in pixel
  await m.waitForTimeout(400)
  await shot(m, 'mobile-bar')
  const got = await m.evaluate(([x, y]) => (window as any).__place.board.colorAt(x, y), target)
  console.log(`mobile placed at (${target[0]},${target[1]}) color 6 → ${got}`)
  await ctx.close()
}

// Zoom b way in on the placed pixel to see the grid + a way out.
await b.page.evaluate(([x, y]) => (window as any).__place.camera.jumpTo(x + 0.5, y + 0.5, 5), [px, py] as [number, number])
await b.page.mouse.move(640 + 40, 400 - 40)
await b.page.waitForTimeout(200)
await shot(b.page, 'b-close')
await a.page.evaluate(() => (window as any).__place.camera.fit())
await b.page.evaluate(() => (window as any).__place.camera.fit())
await a.page.waitForTimeout(300)
await shot(a.page, 'a-fit-after')
await shot(b.page, 'b-fit-after')
console.log('after fit: a zoom', await a.page.locator('.zoomctl .zoom').textContent(), ' b zoom', await b.page.locator('.zoomctl .zoom').textContent())

// Read back what each renderer actually put on screen: center of the placed pixel vs. a corner.
const readback = (page: Page) => page.evaluate(async () => {
  const P = (window as any).__place
  const c = document.getElementById('c') as HTMLCanvasElement
  P.redraw()
  return { size: [c.width, c.height], center: await P.renderer.readPixel(c.width >> 1, c.height >> 1), corner: await P.renderer.readPixel(4, 4) }
})
await a.page.evaluate(([x, y]) => (window as any).__place.camera.jumpTo(x + 0.5, y + 0.5, 5), [px, py] as [number, number])
await a.page.waitForTimeout(250)
// A software WebGPU adapter (headless SwiftShader) cannot be read back at all; report it, don't fail on it.
const tryReadback = (page: Page) => readback(page).catch((e: Error) => ({ error: e.message.split('\n')[0] }))
const rbA = await tryReadback(a.page)
const rbB = await tryReadback(b.page)
console.log('readback a (webgpu, centered 32x):', JSON.stringify(rbA))
console.log('readback b (webgl2, fit):', JSON.stringify(rbB))
const isOrange = (c: number[]) => c[0]! > 200 && c[1]! < 120 && c[2]! < 60
const visualOk = 'center' in rbA ? isOrange(rbA.center) : !process.env.HEADED
if (!('center' in rbA)) console.log('WebGPU readback unavailable in this browser mode' + (process.env.HEADED ? '' : ' (expected headless); run with HEADED=1 to verify on hardware'))

const ok = seenByA === 2 && seenByB === 2 && server === 2 && visualOk
console.log('errors a:', a.errors.length ? a.errors : 'none')
console.log('errors b:', b.errors.length ? b.errors : 'none')
console.log(ok ? 'SMOKE OK' : `SMOKE FAILED (visual=${visualOk})`)
await browser.close()
child?.kill('SIGKILL')
process.exit(ok ? 0 : 1)
