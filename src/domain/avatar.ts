// Single source of truth for avatar palette, shared by the Fastify server
// (random assignment + validation) and the profile picker UI.
export const AVATAR_COLORS = [
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#f43f5e', // rose
] as const

export const DEFAULT_AVATAR_COLOR: string = AVATAR_COLORS[0]

export function isAvatarColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}
