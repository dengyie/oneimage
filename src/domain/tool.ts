export type ExecutionPlane = 'browser' | 'cpu' | 'remote-api'
export type ConfidenceModel = 'deterministic' | 'probabilistic' | 'classifier' | 'visual-quality' | 'none'
export type ToolCategory = 'convert' | 'privacy' | 'generate' | 'repair' | 'inspect'

export interface ToolResult {
  blob: Blob
  filename: string
  warnings: string[]
}

export interface ToolDefinition {
  id: string
  category: ToolCategory
  title: string
  description: string
  executionPlane: ExecutionPlane
  requiresUpload: boolean
  acceptedMime: readonly string[]
  maxInputBytes: number
  confidenceModel: ConfidenceModel
  warningCodes: readonly string[]
}

export interface ToolRegistry {
  get(id: string): ToolDefinition | undefined
  list(): readonly ToolDefinition[]
}
