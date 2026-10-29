// Developer helper: downloads the MI-GAN inpainting model into
// public/models/ for local dev/preview. Production downloads nothing here —
// the model is self-hosted on the origin at /models/ (see deploy docs).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public', 'models')
const outPath = join(outDir, 'migan_pipeline_v2.onnx')
const urls = [
  'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx',
]

mkdirSync(outDir, { recursive: true })
for (const url of urls) {
  try {
    console.log(`fetching ${url} ...`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.byteLength < 10_000_000) throw new Error(`suspiciously small download (${buffer.byteLength} bytes)`)
    writeFileSync(outPath, buffer)
    console.log(`saved ${outPath} (${(buffer.byteLength / 1048576).toFixed(1)} MB)`)
    process.exit(0)
  } catch (err) {
    console.warn(`failed: ${err.message}`)
  }
}
process.exit(1)
