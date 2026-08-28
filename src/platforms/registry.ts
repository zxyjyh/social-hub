import type { Platform, PlatformAdapter } from '../types.js'

/**
 * 平台注册表。接一个新平台 = 实现三个接口 + 在这里注册一行。
 */
const adapters = new Map<Platform, PlatformAdapter>()

export function register(adapter: PlatformAdapter) {
  adapters.set(adapter.platform, adapter)
}

export function get(platform: Platform): PlatformAdapter {
  const a = adapters.get(platform)
  if (!a) throw new Error(`平台未注册：${platform}`)
  return a
}

export function listRegistered(): Platform[] {
  return [...adapters.keys()]
}
