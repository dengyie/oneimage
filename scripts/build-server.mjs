import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'

export const outputDirectory = resolve(process.env.ONEIMAGE_SERVER_BUILD_DIR ?? join(tmpdir(), 'oneimage-server-build'))
await mkdir(outputDirectory, { recursive: true })
await build({
  bundle: true,
  entryPoints: ['server/index.ts'],
  external: ['node:*'],
  format: 'cjs',
  outfile: join(outputDirectory, 'index.cjs'),
  platform: 'node',
  sourcemap: true,
})
