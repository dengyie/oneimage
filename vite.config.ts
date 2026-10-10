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
    environment: 'jsdom',
    restoreMocks: true,
    clearMocks: true,
    exclude: [...configDefaults.exclude, 'providers/**'],
  },
})
