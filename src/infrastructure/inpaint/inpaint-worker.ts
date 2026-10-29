/// <reference lib="webworker" />
// Dedicated worker for the MI-GAN smart eraser: keeps onnxruntime and the
// 26.8 MB model off the main thread. ORT is NOT bundled here — it is imported
// at runtime from the self-hosted /models/ort/ bundle, so the ORT JS glue and
// its WASM pair ship exactly once (in public/models/ort/, served same-origin).
// One session is created lazily and reused for every subsequent run.

import { ensureMiganModel } from './model-cache'
import { ORT_VERSION } from './ort-version'
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

const ORT_BASE = `/models/ort/${ORT_VERSION}`
const ORT_BUNDLE_URL = `${ORT_BASE}/ort.bundle.min.mjs`

export interface SmartEraseRequest {
  type: 'run'
  runId: string
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
  | { type: 'progress'; runId: string; phase: 'model'; loadedBytes: number; totalBytes: number | null }
  | { type: 'stage'; runId: string; stage: 'session' | 'inference' }
  | { type: 'done'; runId: string; rgba: ArrayBuffer }
  | { type: 'error'; runId: string; message: string }

let ortPromise: Promise<OrtNamespace> | null = null
let session: OrtSession | null = null
let sessionCreation: Promise<OrtSession> | null = null

function loadOrt(): Promise<OrtNamespace> {
  if (!ortPromise) {
    ortPromise = import(/* @vite-ignore */ ORT_BUNDLE_URL) as Promise<OrtNamespace>
  }
  return ortPromise
}

async function createSession(runId: string): Promise<OrtSession> {
  const ort = await loadOrt()
  // Threads need cross-origin isolation; without COOP/COEP keep single-thread
  // SIMD so ORT does not stall on a missing SharedArrayBuffer.
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
  ort.env.wasm.numThreads = isolated ? Math.min(4, navigator.hardwareConcurrency || 4) : 1
  ort.env.wasm.wasmPaths = `${ORT_BASE}/`

  // Model download only ever happens on the run that created the session, so
  // its progress messages can carry that run's id.
  const model = await ensureMiganModel((progress) => {
    scope.postMessage({
      type: 'progress',
      runId,
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

async function getSession(runId: string): Promise<OrtSession> {
  if (session) return session
  if (!sessionCreation) {
    sessionCreation = createSession(runId)
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

// Omit over a union collapses to the shared keys, so distribute manually to
// keep per-variant required fields intact.
type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type SmartEraseReport = DistributedOmit<SmartEraseResponse, 'runId'>

// self.postMessage resolves to the Window overload set under the DOM lib; the
// worker-scope transfer-list form needs an explicit cast.
const scope = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void }

async function run(req: SmartEraseRequest): Promise<ArrayBuffer> {
  const report = (response: SmartEraseReport, transfer?: ArrayBuffer): void => {
    scope.postMessage({ ...response, runId: req.runId } satisfies SmartEraseResponse, transfer ? [transfer] : undefined)
  }
  report({ type: 'stage', stage: 'session' })
  const inferenceSession = await getSession(req.runId)
  const ort = await loadOrt()

  report({ type: 'stage', stage: 'inference' })
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
  const req = event.data
  run(req)
    .then((rgba) => {
      scope.postMessage({ type: 'done', runId: req.runId, rgba } satisfies SmartEraseResponse, [rgba])
    })
    .catch((err: unknown) => {
      scope.postMessage({
        type: 'error',
        runId: req.runId,
        message: err instanceof Error ? err.message : String(err),
      } satisfies SmartEraseResponse)
    })
}
