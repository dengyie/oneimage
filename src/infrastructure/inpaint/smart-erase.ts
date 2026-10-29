// Main-thread orchestrator for the MI-GAN smart eraser. Owns the worker
// lifecycle, canvas plumbing and progress reporting so UI code stays
// declarative. All heavy tensor work happens inside the worker.

import type { SmartEraseResponse } from './inpaint-worker'

export interface SmartEraseInput {
  /** Full-resolution RGBA snapshot of the current editor state. */
  image: ImageData
  /** Crisp binary mask (white = erase), same dimensions as the image. */
  mask: ImageData
  /** Feathered alpha mask used only for blending the result back in. */
  composite: ImageData
}

export type SmartEraseStage =
  | { phase: 'model'; loadedBytes: number; totalBytes: number | null }
  | { phase: 'session' }
  | { phase: 'inference' }

function createWorker(): Worker {
  return new Worker(new URL('./inpaint-worker.ts', import.meta.url), { type: 'module' })
}

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) worker = createWorker()
  return worker
}

/**
 * Terminates the worker (and with it the cached ORT session / GPU context).
 * Used on hard failures so the next attempt starts clean.
 */
export function disposeSmartEraseWorker(): void {
  worker?.terminate()
  worker = null
}

export function runSmartErase(
  input: SmartEraseInput,
  onStage: (stage: SmartEraseStage) => void,
  signal?: AbortSignal
): Promise<ImageData> {
  const { width, height } = input.image
  const transfers: ArrayBuffer[] = [input.image.data.buffer, input.mask.data.buffer, input.composite.data.buffer]

  return new Promise<ImageData>((resolve, reject) => {
    const active = getWorker()
    const onMessage = (event: MessageEvent<SmartEraseResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        onStage({ phase: 'model', loadedBytes: message.loadedBytes, totalBytes: message.totalBytes })
        return
      }
      if (message.type === 'stage') {
        onStage({ phase: message.stage })
        return
      }
      if (message.type === 'done') {
        cleanup()
        resolve(new ImageData(new Uint8ClampedArray(message.rgba), width, height))
        return
      }
      cleanup()
      disposeSmartEraseWorker()
      reject(new Error(message.message))
    }
    const onError = (event: ErrorEvent) => {
      cleanup()
      disposeSmartEraseWorker()
      reject(new Error(event.message || '智能修复 Worker 崩溃'))
    }
    const onAbort = () => {
      cleanup()
      disposeSmartEraseWorker()
      reject(new DOMException('已取消', 'AbortError'))
    }

    const cleanup = () => {
      active.removeEventListener('message', onMessage)
      active.removeEventListener('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }

    active.addEventListener('message', onMessage)
    active.addEventListener('error', onError)
    signal?.addEventListener('abort', onAbort)
    active.postMessage(
      {
        type: 'run',
        width,
        height,
        image: input.image.data.buffer,
        mask: input.mask.data.buffer,
        composite: input.composite.data.buffer,
      },
      transfers
    )
  })
}
