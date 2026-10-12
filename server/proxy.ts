import { ProxyAgent, setGlobalDispatcher } from 'undici'

export function configureOutboundProxy(proxyUrl: string | undefined): boolean {
  const normalized = proxyUrl?.trim()
  if (!normalized) return false
  setGlobalDispatcher(new ProxyAgent(normalized))
  return true
}
