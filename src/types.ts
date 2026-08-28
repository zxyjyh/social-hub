/**
 * 公域账号中枢 · 核心契约
 *
 * 设计原则：三个横切面各一个接口，新增平台 = 实现三个接口。
 * 不做过度抽象——这里只有接口和数据结构，没有中间层。
 */

export type Platform = 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE_BUSINESS'

/**
 * 凭证。
 *
 * targetId 是关键设计：把「可发布目标」和授权绑在一起存，
 * 让「一个授权对应一个发布目标」成为数据结构层面的约束，
 * 而不是散落在业务代码里的隐含假设。
 */
export interface Credential {
  bizId: string // 澳觅侧主体：'AOMI_SELF' 或门店 ID
  platform: Platform
  accessToken: string
  refreshToken?: string
  /** Facebook 的 Page token 不过期，此处为空；User token 与 IG token 才有 60 天 */
  expiresAt?: Date
  accountId: string
  accountName: string
  /** FB 的 pageId / IG 的 igUserId / Google 的 locationId */
  targetId: string
  targetName: string
}

// ── 一、授权与账号 ────────────────────────────────────────────

export interface PlatformAuth {
  getAuthUrl(bizId: string): Promise<{ url: string; state: string }>
  handleCallback(code: string, state: string): Promise<Credential>
  /** 内部判断是否临近过期并自动刷新；Page token 这类不过期的直接返回 */
  getValidAccessToken(bizId: string): Promise<string>
  getAccountInfo(bizId: string): Promise<{ name: string; avatar?: string }>
}

// ── 二、发布 ─────────────────────────────────────────────────

export interface PublishTask {
  bizId: string
  platform: Platform
  text: string
  mediaUrls?: string[]
  /** 排期时间，不传即立即发布 */
  scheduledAt?: Date
  /** Google 专用：OFFER / EVENT 帖的附加字段 */
  offer?: { couponCode?: string; redeemUrl?: string; terms?: string }
  languageCode?: string
}

export interface PublishResult {
  postId: string
  /** 公开可访问的链接。Google 的 searchUrl 可直接在 Maps 上验证 */
  permalink?: string
}

export interface PlatformPublish {
  publish(task: PublishTask): Promise<PublishResult>
  /** 发布后回查，确认平台侧真的存在 */
  verify(bizId: string, postId: string): Promise<boolean>
  delete(bizId: string, postId: string): Promise<void>
}

// ── 三、回流 ─────────────────────────────────────────────────

export interface PostMetrics {
  impressions?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
}

export interface Comment {
  id: string
  authorName: string
  text: string
  createdAt: Date
  replied: boolean
}

export interface PlatformInsight {
  getAccountMetrics(bizId: string): Promise<PostMetrics & { followers?: number }>
  getPostMetrics(bizId: string, postId: string): Promise<PostMetrics>
  listComments(bizId: string, postId: string): Promise<Comment[]>
  /** 只有 Instagram 官方支持自动回复；不支持的平台抛 UnsupportedError */
  replyComment(bizId: string, commentId: string, text: string): Promise<void>
}

/** 一个平台的完整实现 */
export interface PlatformAdapter extends PlatformAuth, PlatformPublish, PlatformInsight {
  readonly platform: Platform
}
