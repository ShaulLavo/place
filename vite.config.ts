import { defineConfig } from 'vite'
import solid from '@solidjs/vite-plugin'

// Classic client mode: our own index.html + src/client/main.tsx mount.
// No "start mode" — Elysia is the only server (see PLAN.md).
// BASE_PATH lets the built app live under a route prefix behind a reverse proxy, e.g. BASE_PATH=/place/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [solid()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
