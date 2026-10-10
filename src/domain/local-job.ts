import type { ToolResult } from './tool'

export type LocalJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface LocalJob {
  id: string
  toolId: string
  status: LocalJobStatus
  createdAt: string
  result?: ToolResult
  error?: Error
}

export interface LocalJobDependencies {
  id: () => string
  now: () => Date
}

export type LocalJobEvent =
  | { type: 'start' }
  | { type: 'succeed'; result: ToolResult }
  | { type: 'fail'; error: Error }
  | { type: 'cancel' }

const transitions: Readonly<Record<LocalJobStatus, readonly LocalJobEvent['type'][]>> = {
  queued: ['start', 'cancel', 'fail'],
  running: ['succeed', 'fail', 'cancel'],
  succeeded: [],
  failed: [],
  cancelled: [],
}

export function createLocalJob(toolId: string, dependencies: LocalJobDependencies): LocalJob {
  return {
    id: dependencies.id(),
    toolId,
    status: 'queued',
    createdAt: dependencies.now().toISOString(),
  }
}

export function advanceLocalJob(job: LocalJob, event: LocalJobEvent): LocalJob {
  if (!transitions[job.status].includes(event.type)) {
    throw new Error(`invalid job transition: ${job.status} -> ${event.type}`)
  }

  if (event.type === 'start') return { ...job, status: 'running' }
  if (event.type === 'succeed') return { ...job, status: 'succeeded', result: event.result, error: undefined }
  if (event.type === 'fail') return { ...job, status: 'failed', error: event.error, result: undefined }
  return { ...job, status: 'cancelled', error: undefined, result: undefined }
}
