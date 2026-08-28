/**
 * 错误分级。
 *
 * 这两个分支是「demo」和「能上生产的东西」之间的分界线：
 * 限流和服务端错误值得重试，其余的重试多少次都一样。
 */
export class PublishError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'PublishError'
  }

  static fromHttpStatus(status: number, message: string, detail?: unknown): PublishError {
    const retryable = status === 429 || status >= 500
    return new PublishError(message, retryable, detail)
  }
}

export class UnsupportedError extends Error {
  constructor(platform: string, capability: string) {
    super(`${platform} 不支持 ${capability}`)
    this.name = 'UnsupportedError'
  }
}
