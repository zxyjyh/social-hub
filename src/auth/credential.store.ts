import type { Credential, Platform } from '../types.js'

/**
 * 凭证存储。
 *
 * 先用内存实现跑通流程，接数据库时只换这一个文件。
 * accessToken 落库前必须加密（CREDENTIAL_ENCRYPTION_KEY）。
 */
export interface CredentialStore {
  save(cred: Credential): Promise<void>
  get(bizId: string, platform: Platform): Promise<Credential | null>
  list(bizId: string): Promise<Credential[]>
  remove(bizId: string, platform: Platform): Promise<void>
}

export class InMemoryCredentialStore implements CredentialStore {
  private readonly data = new Map<string, Credential>()

  private key(bizId: string, platform: Platform) {
    return `${bizId}:${platform}`
  }

  async save(cred: Credential) {
    this.data.set(this.key(cred.bizId, cred.platform), cred)
  }

  async get(bizId: string, platform: Platform) {
    return this.data.get(this.key(bizId, platform)) ?? null
  }

  async list(bizId: string) {
    return [...this.data.values()].filter((c) => c.bizId === bizId)
  }

  async remove(bizId: string, platform: Platform) {
    this.data.delete(this.key(bizId, platform))
  }
}
