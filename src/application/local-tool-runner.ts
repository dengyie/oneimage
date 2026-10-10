import { advanceLocalJob, createLocalJob, type LocalJob } from '../domain/local-job'
import type { ToolResult } from '../domain/tool'
import { runBrowserImageTool, type LocalToolOptions } from '../infrastructure/browser-image-processor'

export async function runLocalTool(
  toolId: string,
  file: File,
  options: LocalToolOptions,
  signal: AbortSignal,
  onUpdate?: (job: LocalJob) => void,
): Promise<ToolResult> {
  let job = createLocalJob(toolId, { id: () => crypto.randomUUID(), now: () => new Date() })
  onUpdate?.(job)
  job = advanceLocalJob(job, { type: 'start' })
  onUpdate?.(job)
  try {
    const result = await runBrowserImageTool(toolId, file, options, signal)
    job = advanceLocalJob(job, { type: 'succeed', result })
    onUpdate?.(job)
    return result
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    if (error.name === 'AbortError') {
      job = advanceLocalJob(job, { type: 'cancel' })
      onUpdate?.(job)
      throw error
    }
    job = advanceLocalJob(job, { type: 'fail', error })
    onUpdate?.(job)
    throw error
  }
}
