import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { outputDirectory } from './build-server.mjs'

const child = spawn(process.execPath, [join(outputDirectory, 'index.cjs')], {
  env: process.env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.once('error', (error) => {
  process.stderr.write(`OneImage server failed to start: ${error.message}\n`)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
