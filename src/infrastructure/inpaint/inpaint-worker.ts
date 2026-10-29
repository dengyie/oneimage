/// <reference lib="webworker" />
// Dedicated worker for the MI-GAN smart eraser: keeps onnxruntime and the
// 26.8 MB model off the main thread. ORT is NOT bundled here — it is imported
// at runtime from the self-hosted /models/ort/ bundle, so the ORT JS glue and
// its WASM pair ship exactly once (in public/models/ort/, served same-origin).
// One session is created lazily and reused for every subsequent run.

import { ensureMiganModel } from './model-cache'
import {
  compositeMasked,
  maskToBinary,
  rgbaToRgbChw,
  rgbChwToRgba,
  type RgbaPlane,
} from './inpaint-core'

// Minimal structural contract for the runtime-loaded ORT bundle. Kept local
// (instead of importing onnxruntime-web types) so the worker's types do not
// track a specific ORT version; the runtime source is the self-hosted bundle.
interface OrtSession {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Uint8Array }>>
}

interface OrtNamespace {
  env: { wasm: { numThreads: number; wasmPaths: string } }
  InferenceSession: {
    create(model: ArrayBuffer, options?: { executionProviders?: string[] }): Promise<OrtSession>
  }
  Tensor: new (type: string, data: Uint8Array, dims: number[]) => unknown
}

const ORT_BUNDLE_URL = '/models/ort/ort.bundle.min.mjs'

export interface SmartEraseRequest {
  type: 'run'
  width: number
  height: number
  /** RGBA of the current full-resolution snapshot. */
  image: ArrayBuffer
  /** RGBA mask canvas: white = region to inpaint (crisp, drives the model). */
  mask: ArrayBuffer
  /** RGBA feathered alpha used only for the final composite. */
  composite: ArrayBuffer
}

export type SmartEraseResponse =
  | { type: 'progress'; phase: 'model'; loadedBytes: number; totalBytes: number | null }
  | { type: 'stage'; stage: 'session' | 'inference' }
  | { type: 'done'; rgba: ArrayBuffer }
  | { type: 'error'; message: string }

let ortPromise: Promise<OrtNamespace> | null = null
let session: OrtSession | null = null
let sessionCreation: Promise<OrtSession> | null = null

function loadOrt(): Promise<OrtNamespace> {
  if (!ortPromise) {
    ortPromise = import(/* @vite-ignore */ ORT_BUNDLE_URL) as Promise<OrtNamespace>
  }
  return ortPromise
}

async function createSession(): Promise<OrtSession> {
  const ort = await loadOrt()
  // Threads need cross-origin isolation; without COOP/COEP keep single-thread
  // SIMD so ORT does not stall on a missing SharedArrayBuffer.
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1
  ort.env.wasm.wasmPaths = '/models/ort/'

  const model = await ensureMiganModel((progress) => {
    postMessage({
      type: 'progress',
      phase: 'model',
      loadedBytes: progress.loadedBytes,
      totalBytes: progress.totalBytes,
    } satisfies SmartEraseResponse)
  })
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator
  try {
    return await ort.InferenceSession.create(model, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] })
  } catch (err) {
    if (gpu) {
      // WebGPU present but the model/adapter rejected it (driver, OOM,
      // unsupported ops): fall back to WASM instead of failing the run.
      return ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
    }
    throw err
  }
}

async function getSession(): Promise<NonNullable<typeof session>> {
  if (session) return session
  if (!sessionCreation) {
    sessionCreation = createSession()
      .then((created) => {
        session = created
        return created
      })
      .catch((err) => {
        sessionCreation = null
        throw err
      })
  }
  return sessionCreation
}

async function run(req: SmartEraseRequest): Promise<ArrayBuffer> {
  postMessage({ type: 'stage', stage: 'session' } satisfies SmartEraseResponse)
  const inferenceSession = await getSession()
  const ort = await loadOrt()

  postMessage({ type: 'stage', stage: 'inference' } satisfies SmartEraseResponse)
  const imagePlane: RgbaPlane = { data: new Uint8ClampedArray(req.image), width: req.width, height: req.height }
  const maskPlane: RgbaPlane = { data: new Uint8ClampedArray(req.mask), width: req.width, height: req.height }
  const alphaPlane: RgbaPlane = { data: new Uint8ClampedArray(req.composite), width: req.width, height: req.height }

  const imageTensor = new ort.Tensor('uint8', rgbaToRgbChw(imagePlane), [1, 3, req.height, req.width])
  const maskTensor = new ort.Tensor('uint8', maskToBinary(maskPlane), [1, 1, req.height, req.width])
  const feeds: Record<string, InstanceType<OrtNamespace['Tensor']>> = {
    [inferenceSession.inputNames[0]]: imageTensor,
    [inferenceSession.inputNames[1]]: maskTensor,
  }

  const results = await inferenceSession.run(feeds)
  const output = results[inferenceSession.outputNames[0]]
  const generatedRgba = rgbChwToRgba(
    output.data as Uint8Array,
    imagePlane.data,
    req.width,
    req.height
  )
  const blended = compositeMasked(
    imagePlane,
    { data: generatedRgba, width: req.width, height: req.height },
    alphaPlane
  )
  return blended.buffer.slice(0) as ArrayBuffer
}

self.onmessage = (event: MessageEvent<SmartEraseRequest>) => {
  if (event.data?.type !== 'run') return
  run(event.data)
    .then((rgba) => {
      postMessage({ type: 'done', rgba } satisfies SmartEraseResponse, [rgba])
    })
    .catch((err: unknown) => {
      postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies SmartEraseResponse)
    })
}
