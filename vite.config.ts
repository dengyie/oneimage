import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const apiTarget = `http://127.0.0.1:${process.env.PORT ?? '8787'}`

export default defineConfig({
  plugins: [react()],
  cacheDir: join(tmpdir(), 'oneimage-vite-cache'),
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        headers: { origin: apiTarget },
      },
    },
  },
  test: {
    // Nothing under test needs the DOM: the suites exercise pure domain logic,
    // Node-side Fastify routes, and adapters over Node's global File/Blob/fetch.
    // Booting jsdom per file accounted for ~93% of test runtime.
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'providers/**'],
  },
})
