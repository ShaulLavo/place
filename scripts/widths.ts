// Screenshot the drawer at several window widths. Usage: bun scripts/widths.ts [baseUrl] [outDir]
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? 'smoke-out'
mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
for (const w of [1280, 900, 760, 640, 480]) {
  const page = await browser.newPage({ viewport: { width: w, height: 700 } })
  await page.goto(`${base}/?renderer=webgl2`)
  await page.waitForSelector('.loading', { state: 'detached', timeout: 15000 })
  await page.locator('.swatch').nth(13).click()
  await page.waitForTimeout(300)
  const bar = await page.locator('.bar').boundingBox()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  console.log(`${w}px: bar ${Math.round(bar!.width)}x${Math.round(bar!.height)} overflow=${overflow}`)
  await page.screenshot({ path: `${out}/w${w}.png`, clip: { x: 0, y: 700 - Math.round(bar!.height) - 4, width: w, height: Math.round(bar!.height) + 4 } })
  await page.close()
}
await browser.close()
process.exit(0)
