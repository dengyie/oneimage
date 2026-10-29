// Copies the onnxruntime-web WASM/JS-glue assets into public/models/ort/ so
// the build serves them same-origin (the worker sets ort.env.wasm.wasmPaths to
// this directory). Only the two loader pairs the wasm and webgpu execution
// providers actually fetch are copied, to keep the release archive lean.
// Runs before build/dev; the files are not committed.
import { mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const distDir = join(root, '..', 'node_modules', 'onnxruntime-web', 'dist')
const outDir = join(root, '..', 'public', 'models', 'ort')
mkdirSync(outDir, { recursive: true })

const required = [
  'ort.bundle.min.mjs',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.jsep.wasm',
]
for (const name of required) {
  copyFileSync(join(distDir, name), join(outDir, name))
}
console.log(`copy-ort-wasm: ${required.length} assets -> public/models/ort/`)
