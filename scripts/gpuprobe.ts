// Which WebGPU adapter does Chromium expose? Launches Chromium directly and attaches over CDP.
// Usage: [NOHEADLESS=1] [URL=http://localhost:3100/] bun scripts/gpuprobe.ts [chromium flags...]
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const flags = process.argv.slice(2)
const port = 9333 + Math.floor(Math.random() * 100)
const proc = spawn(process.env.CHROME ?? '/usr/bin/chromium', [
  ...(process.env.NOHEADLESS ? [] : ['--headless=new']), `--remote-debugging-port=${port}`, '--no-sandbox', '--no-first-run', '--user-data-dir=/tmp/claude-1000/-work-projects/79bacd97-58b2-4d93-af13-5ffbe0cb721f/scratchpad/chrome-profile-' + port,
  ...flags, 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })
let stderr = ''
proc.stderr.on('data', (d) => { stderr += d })
await new Promise((r) => setTimeout(r, 2500))
try {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10000 })
  const page = await browser.contexts()[0]!.newPage()
  if (process.env.URL) await page.goto(process.env.URL)
  const r = await page.evaluate(async () => {
    const gpu = (navigator as { gpu?: GPU }).gpu
    if (!gpu) return `no navigator.gpu (secure=${window.isSecureContext} href=${location.href})`
    const ad = await gpu.requestAdapter()
    if (!ad) return 'adapter null'
    const info = ad.info
    return `adapter: ${info.vendor}/${info.architecture}/${info.device}/${info.description} fallback=${(info as { isFallbackAdapter?: boolean }).isFallbackAdapter}`
  })
  console.log(`[${flags.join(' ')}] → ${r}`)
  await browser.close()
} catch (e) {
  console.log(`[${flags.join(' ')}] → CDP error: ${(e as Error).message.split('\n')[0]}`)
  console.log(stderr.split('\n').filter((l) => /gpu|vulkan|dawn|webgpu/i.test(l)).slice(0, 5).join('\n'))
}
proc.kill('SIGKILL')
process.exit(0)
