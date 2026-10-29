// One-off verification: run the real MI-GAN pipeline in Node (ORT wasm EP)
// to pin the model's I/O contract before shipping the smart eraser.
import * as ort from 'onnxruntime-web'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = pathToFileURL(process.cwd() + '/node_modules/onnxruntime-web/dist/').href
const model = readFileSync('public/models/migan_pipeline_v2.onnx')
const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
console.log('inputs:', session.inputNames, 'outputs:', session.outputNames)

for (const [W, H] of [[512, 512], [640, 400]]) {
  const img = new Uint8Array(1 * 3 * H * W).fill(128)
  const mask = new Uint8Array(1 * 1 * H * W)
  for (let y = Math.floor(H * 0.4); y < Math.floor(H * 0.6); y++) {
    for (let x = Math.floor(W * 0.4); x < Math.floor(W * 0.6); x++) mask[y * W + x] = 255
  }
  const t0 = Date.now()
  const results = await session.run({
    [session.inputNames[0]]: new ort.Tensor('uint8', img, [1, 3, H, W]),
    [session.inputNames[1]]: new ort.Tensor('uint8', mask, [1, 1, H, W]),
  })
  const out = results[session.outputNames[0]]
  let min = 255, max = 0
  for (const v of out.data) { if (v < min) min = v; if (v > max) max = v }
  console.log(`${W}x${H} -> dims=${out.dims.join('x')} type=${out.type} ms=${Date.now() - t0} range=${min}..${max}`)
}
