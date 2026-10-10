export type RequestHeaders = Record<string, string | string[] | undefined>

export function authorizeProvenanceRequest(headers: RequestHeaders, serverToken: string, allowDevelopmentOrigin: boolean): boolean {
  const suppliedToken = headers['x-oneimage-token']
  if (serverToken.length > 0) return typeof suppliedToken === 'string' && suppliedToken === serverToken
  if (!allowDevelopmentOrigin) return false

  const origin = headers.origin
  const host = headers.host
  if (typeof origin !== 'string' || typeof host !== 'string') return false
  const forwardedProto = headers['x-forwarded-proto']
  const protocol = typeof forwardedProto === 'string' && forwardedProto === 'https' ? 'https' : 'http'
  return origin === `${protocol}://${host}`
}
