# Plan 1：端到端骨架 + Facebook 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通一条完整链路——mock 门店与团单数据 → Claude 生成文案 → 发布到真实 Facebook Page → 回查确认 → 落 SQLite → 极简后台页面可以点。

**Architecture:** 四层正交：`content/` 生成中性素材包 `ContentDraft`，`platforms/facebook/` 用纯函数 `format()` 把它裁成 `PublishTask` 再发布，`publishing/pipeline.ts` 负责校验与退避重试，`storage/` 用 SQLite 落盘且凭证加密。每个平台的 HTTP 调用封装在 `Transport` 接口后，测试注入假实现，因此三个适配器全部可离线单测。

**Tech Stack:** TypeScript 5.6 + Node 20（ESM）、Hono + @hono/node-server、better-sqlite3、@anthropic-ai/sdk、vitest。

**Spec:** `docs/superpowers/specs/2026-08-28-social-hub-design.md`

## Global Constraints

- **Node 20.19.3**。`node:sqlite` 在此版本不存在，必须用 `better-sqlite3`。
- **ESM**（`package.json` 的 `"type": "module"`）。`__dirname` 与 `__filename` 未定义，用了会抛 `ReferenceError`。需要脚本相对路径时用 `path.dirname(fileURLToPath(import.meta.url))`。**所有本地 import 必须带 `.js` 后缀**（如 `from './types.js'`），现有代码已是这个写法。
- **Graph API 版本 `v26.0`**。`.env.example` 里现在是 `v23.0`，Task 1 改掉。
- **Claude 模型 ID 恒为 `claude-opus-5`**，不加日期后缀。用 `thinking: { type: "adaptive" }`；`budget_tokens` 在此模型上会返回 400。
- **发文语言恒为简体中文，`languageCode` 恒为 `'zh-CN'`**（spec §3.1）。
- **代码注释与后台界面用简体中文**，与现有代码一致。
- **不实现任何自动点赞 / 收藏 / 关注 / 养号**（spec §2 红线）。
- **`PostMetrics.impressions` 不从 Meta 取数**——旧指标已于 2026-06-15 下线（spec §4）。Plan 1 不做指标，Plan 3 按 Media Views 口径实现。
- 每个 Task 结束时提交，commit message 用中文，遵循 `feat:` / `test:` / `chore:` 前缀。

---

### Task 1: 项目基座与依赖

**Files:**
- Modify: `package.json`
- Modify: `.env.example:5`
- Create: `src/config.ts`
- Test: `src/config.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `loadConfig(): Config`，其中
  `Config = { metaAppId: string; metaAppSecret: string; metaRedirectUri: string; metaGraphVersion: string; databaseUrl: string; credentialEncryptionKey: string; port: number }`

- [ ] **Step 1: 安装依赖并加脚本**

```bash
npm install @anthropic-ai/sdk hono @hono/node-server better-sqlite3 dotenv
npm install -D vitest @types/better-sqlite3
```

把 `package.json` 的 `scripts` 改成：

```json
"scripts": {
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 2: 构建时排除测试文件**

`tsconfig.json` 的 `include` 是 `src/**/*`，测试文件会被一起编译进 `dist`。
`typecheck` 需要覆盖测试（保留 include），但 `build` 不需要产物。加一行 `exclude`：

```json
{
  "compilerOptions": { ... 保持不变 ... },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

`npm run typecheck` 用 `--noEmit`，`exclude` 同样生效，因此测试文件不再被 tsc 检查——
但 vitest 自己会做类型解析，且测试的正确性由运行结果保证，可以接受。
若希望测试也过 tsc，另建 `tsconfig.test.json` 继承主配置并去掉 `exclude`，
本计划不做这一步。

- [ ] **Step 3: 把 Graph API 版本改成 v26.0**

`.env.example` 第 5 行：

```
META_GRAPH_VERSION=v26.0
```

- [ ] **Step 4: 写失败的测试**

创建 `src/config.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from './config.js'

const REQUIRED = {
  META_APP_ID: 'app-123',
  META_APP_SECRET: 'secret-456',
  CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
}

describe('loadConfig', () => {
  let saved: NodeJS.ProcessEnv

  beforeEach(() => {
    saved = { ...process.env }
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('META_') || k.startsWith('CREDENTIAL_') || k === 'DATABASE_URL' || k === 'PORT') {
        delete process.env[k]
      }
    }
    Object.assign(process.env, REQUIRED)
  })

  afterEach(() => {
    process.env = saved
  })

  it('缺少必填变量时抛出，并指出是哪个变量', () => {
    delete process.env.META_APP_SECRET
    expect(() => loadConfig()).toThrow(/META_APP_SECRET/)
  })

  it('Graph API 版本默认 v26.0', () => {
    expect(loadConfig().metaGraphVersion).toBe('v26.0')
  })

  it('加密密钥必须是 64 位十六进制（32 字节）', () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'tooshort'
    expect(() => loadConfig()).toThrow(/CREDENTIAL_ENCRYPTION_KEY/)
  })

  it('数据库路径默认 ./social-hub.db', () => {
    expect(loadConfig().databaseUrl).toBe('./social-hub.db')
  })
})
```

- [ ] **Step 5: 跑测试确认失败**

Run: `npm test`
Expected: FAIL，报 `Failed to resolve import "./config.js"`

- [ ] **Step 6: 写最小实现**

创建 `src/config.ts`：

```typescript
import 'dotenv/config'

/** 运行时配置。所有环境变量在进程启动时一次性校验，不在业务代码里到处兜底。 */
export interface Config {
  metaAppId: string
  metaAppSecret: string
  metaRedirectUri: string
  metaGraphVersion: string
  databaseUrl: string
  credentialEncryptionKey: string
  port: number
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`缺少必填环境变量：${name}`)
  return v
}

export function loadConfig(): Config {
  const key = required('CREDENTIAL_ENCRYPTION_KEY')
  // AES-256 需要 32 字节密钥，以十六进制表示即 64 个字符
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY 必须是 64 位十六进制字符（32 字节）')
  }

  return {
    metaAppId: required('META_APP_ID'),
    metaAppSecret: required('META_APP_SECRET'),
    metaRedirectUri: process.env.META_REDIRECT_URI ?? 'http://localhost:3000/auth/meta/callback',
    metaGraphVersion: process.env.META_GRAPH_VERSION ?? 'v26.0',
    databaseUrl: process.env.DATABASE_URL ?? './social-hub.db',
    credentialEncryptionKey: key,
    port: Number(process.env.PORT ?? 3000),
  }
}
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npm test`
Expected: PASS，4 个测试全绿

- [ ] **Step 8: 提交**

```bash
git add package.json package-lock.json tsconfig.json .env.example src/config.ts src/config.test.ts
git commit -m "chore: 项目基座——依赖、vitest、配置校验

Graph API 起步版本从 v23.0 改为 v26.0（设计文档 §4）。
配置在进程启动时一次性校验，包括加密密钥必须是 32 字节。"
```

---

### Task 2: 契约层与错误分级

**Files:**
- Modify: `src/types.ts`（整体重写）
- Test: `src/publishing/errors.test.ts`
- Modify: `src/platforms/registry.ts:1`（import 路径不变，仅确认类型仍编译）

**Interfaces:**
- Consumes: 无
- Produces:
  - `Platform`、`Credential`、`TokenPolicy`、`PlatformCapabilities`
  - `ContentDraft`、`PublishTask`、`PublishValidationIssue`、`PublishHandle`、`PublishResult`、`CompletionStrategy`
  - `PlatformAuth`、`PlatformPublish`、`PlatformAdapter`
  - `PublishError.fromHttpStatus(status, message, detail?)`（已存在，本任务补测试）

- [ ] **Step 1: 写失败的测试**

创建 `src/publishing/errors.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { PublishError, UnsupportedError } from './errors.js'

describe('PublishError.fromHttpStatus', () => {
  it('429 限流可重试', () => {
    expect(PublishError.fromHttpStatus(429, '限流').retryable).toBe(true)
  })

  it('500 与 503 服务端错误可重试', () => {
    expect(PublishError.fromHttpStatus(500, '内部错误').retryable).toBe(true)
    expect(PublishError.fromHttpStatus(503, '不可用').retryable).toBe(true)
  })

  it('400 与 401 不可重试——重试多少次都一样', () => {
    expect(PublishError.fromHttpStatus(400, '参数错').retryable).toBe(false)
    expect(PublishError.fromHttpStatus(401, '未授权').retryable).toBe(false)
  })

  it('404 不可重试', () => {
    expect(PublishError.fromHttpStatus(404, '不存在').retryable).toBe(false)
  })

  it('保留原始 detail 供排查', () => {
    const detail = { error: { code: 190 } }
    expect(PublishError.fromHttpStatus(401, '未授权', detail).detail).toEqual(detail)
  })
})

describe('UnsupportedError', () => {
  it('消息里带上平台与能力名', () => {
    const e = new UnsupportedError('GOOGLE_BUSINESS', '回复帖子评论')
    expect(e.message).toContain('GOOGLE_BUSINESS')
    expect(e.message).toContain('回复帖子评论')
  })
})
```

- [ ] **Step 2: 跑测试确认通过（errors.ts 已存在且正确）**

Run: `npm test src/publishing/errors.test.ts`
Expected: PASS。这一步是给既有代码补测试网，不是 TDD 的红灯。若失败，说明 `errors.ts` 与预期不符，先修它。

- [ ] **Step 3: 重写 types.ts**

用以下内容整体替换 `src/types.ts`：

```typescript
/**
 * 公域账号中枢 · 核心契约
 *
 * 设计原则：授权、发布、回流三个横切面，外加一个与平台正交的内容生成层。
 * 新增平台 = 实现三个接口 + 一个纯函数 format()。
 */

export type Platform = 'FACEBOOK' | 'INSTAGRAM' | 'GOOGLE_BUSINESS'

/**
 * 凭证。
 *
 * targetId 是关键设计：把「可发布目标」和授权绑在一起存，
 * 让「一个授权对应一个发布目标」成为数据结构层面的约束。
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

/** token 刷新策略。FB Page token 不可刷新也不需要刷新，不能一刀切。 */
export interface TokenPolicy {
  refreshable: boolean
  /** 距过期多久开始刷新，毫秒 */
  refreshBeforeMs?: number
}

/**
 * 平台能力声明。
 *
 * 声明式优于抛异常：后台可提前禁用按钮，而不是让用户点了才失败。
 * replyPostComment 与 reviews 必须分开——Google 不能回帖子评论，但能读写商家评价。
 */
export interface PlatformCapabilities {
  /** 回复帖子评论。FB ✅ IG ✅ Google ❌ */
  replyPostComment: boolean
  /** 读取与回复商家评价。FB ❌ IG ❌ Google ✅ */
  reviews: boolean
  /** 读取 @提及与被标记媒体。FB ❌ IG ✅ Google ❌ */
  mentions: boolean
  /** 结构化优惠字段。仅 Google ✅ */
  offerFields: boolean
  /** 原生多语言字段。仅 Google ✅ */
  nativeLanguageCode: boolean
  /** 帖子正文外链可点。FB ✅ IG ❌ Google ✅ */
  clickableLink: boolean
  /** 写入门店结构化信息。仅 Google ✅ */
  businessInfoWrite: boolean
  /** 帖子级指标可用性 */
  postMetrics: boolean
}

// ── 内容生成层（与平台正交）─────────────────────────────────

/** 门店。字段取澳觅内部数据的子集，Plan 1 由 MockDataSource 提供。 */
export interface Store {
  id: string
  name: string
  address: string
  phone?: string
  /** 营业时间，自由文本，如 '11:00-22:00' */
  businessHours?: string
  category: string
}

/** 在售团单。 */
export interface Deal {
  id: string
  storeId: string
  title: string
  /** 现价，单位为澳门元分，避免浮点误差 */
  priceCents: number
  originalPriceCents: number
  description: string
  imageUrls: string[]
}

/**
 * 中性素材包：生成层的产物，与任何平台无关。
 * 各平台的 format() 从中取用自己需要的部分。
 */
export interface ContentDraft {
  storeId: string
  dealId?: string
  /** v1 恒为 'zh-CN'。Google localPost 的必填字段，一路透传 */
  languageCode: string
  headline: string
  /** 按最长平台（Facebook）产出，短平台在 format() 里截断 */
  text: string
  imageUrls: string[]
  videoUrl?: string
  /** 外链号召。Google 有原生字段，FB 拼进正文，IG 正文链接不可点 */
  callToAction?: { label: string; url: string }
  /** 结构化优惠，只有 Google 能原生承载 */
  offer?: { couponCode?: string; redeemUrl?: string; terms?: string }
}

// ── 一、授权与账号 ────────────────────────────────────────────

export interface PlatformAuth {
  getAuthUrl(bizId: string): Promise<{ url: string; state: string }>
  handleCallback(code: string, state: string): Promise<Credential>
  /** 内部按 tokenPolicy 判断是否临近过期并自动刷新 */
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

export interface PublishValidationIssue {
  field: string
  message: string
}

/**
 * 发布完成策略。
 *
 * SYNC 直接拿到 postId（Facebook 文字帖）；
 * POLLING 先拿到 pendingToken 再轮询（Instagram 容器模式）。
 * 把这个差异放进契约，是因为「publish 同步返回 postId」对 IG 根本不成立。
 */
export type CompletionStrategy = 'SYNC' | 'POLLING'

export interface PublishHandle {
  strategy: CompletionStrategy
  /** SYNC 时直接给出 */
  postId?: string
  /** POLLING 时给出，如 IG 的容器 id */
  pendingToken?: string
}

export interface PublishResult {
  postId: string
  /** 公开可访问的链接。Google 的 searchUrl 可直接在 Maps 上验证 */
  permalink?: string
}

export interface PlatformPublish {
  /** 同步纯函数。在发起请求之前报错，不消耗 API 配额 */
  validate(task: PublishTask): PublishValidationIssue[]
  publish(task: PublishTask): Promise<PublishHandle>
  /** 仅 POLLING 策略实现；轮询至就绪后完成发布 */
  awaitCompletion?(bizId: string, pendingToken: string): Promise<PublishResult>
  /** 发布后回查，确认平台侧真的存在 */
  verify(bizId: string, postId: string): Promise<boolean>
  delete(bizId: string, postId: string): Promise<void>
}

// ── 适配器 ───────────────────────────────────────────────────

/** 一个平台的完整实现 */
export interface PlatformAdapter extends PlatformAuth, PlatformPublish {
  readonly platform: Platform
  readonly capabilities: PlatformCapabilities
  readonly tokenPolicy: TokenPolicy
  /** 纯函数：中性素材包 → 该平台的发布任务 */
  format(draft: ContentDraft, bizId: string): PublishTask
}
```

> 回流面（`PlatformInsight` / `PlatformInteraction`）在 Plan 3 加入。Plan 1 的 `PlatformAdapter` 只含授权与发布，这样 Facebook 适配器可以完整实现而不留空方法。

- [ ] **Step 4: 类型检查与全量测试**

Run: `npm run typecheck && npm test`
Expected: 两条命令都通过。`registry.ts` 引用的 `Platform` 与 `PlatformAdapter` 仍存在，不需要改。

- [ ] **Step 5: 提交**

```bash
git add src/types.ts src/publishing/errors.test.ts
git commit -m "feat: 契约层重写，补错误分级测试

引入 CompletionStrategy 与 PublishHandle 承载 IG 容器模式；
新增同步的 validate()；能力声明拆成 8 个字段，其中
replyPostComment 与 reviews 分开——Google 不能回帖子评论但能回评价；
token 刷新策略按平台声明。新增内容生成层的 Store / Deal / ContentDraft。"
```

---

### Task 3: SQLite 存储与凭证加密

**Files:**
- Create: `src/storage/crypto.ts`
- Create: `src/storage/db.ts`
- Create: `src/storage/credential.store.ts`
- Delete: `src/auth/credential.store.ts`（移动到 `storage/`，接口不变）
- Test: `src/storage/crypto.test.ts`
- Test: `src/storage/credential.store.test.ts`

**Interfaces:**
- Consumes: `Credential`、`Platform`（Task 2）
- Produces:
  - `encrypt(plaintext: string, keyHex: string): string`、`decrypt(payload: string, keyHex: string): string`
  - `openDb(path: string): Database`（`better-sqlite3` 的 `Database` 类型），建表幂等
  - `CredentialStore` 接口：`save(cred)`、`get(bizId, platform)`、`list(bizId)`、`remove(bizId, platform)`
  - `SqliteCredentialStore`、`InMemoryCredentialStore`

- [ ] **Step 1: 写加密的失败测试**

创建 `src/storage/crypto.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from './crypto.js'

const KEY = 'b'.repeat(64)
const OTHER_KEY = 'c'.repeat(64)

describe('凭证加密', () => {
  it('加密后能原样解回来', () => {
    const token = 'EAAG...page-token'
    expect(decrypt(encrypt(token, KEY), KEY)).toBe(token)
  })

  it('密文里不出现明文', () => {
    const token = 'super-secret-token'
    expect(encrypt(token, KEY)).not.toContain(token)
  })

  it('同一明文两次加密结果不同（IV 随机）', () => {
    expect(encrypt('same', KEY)).not.toBe(encrypt('same', KEY))
  })

  it('换一把密钥解不开', () => {
    expect(() => decrypt(encrypt('x', KEY), OTHER_KEY)).toThrow()
  })

  it('密文被篡改会被认证标签发现', () => {
    const payload = encrypt('x', KEY)
    const parts = payload.split(':')
    parts[2] = Buffer.from('tampered').toString('base64')
    expect(() => decrypt(parts.join(':'), KEY)).toThrow()
  })

  it('支持中文与 emoji', () => {
    const s = '澳觅门店 🍜'
    expect(decrypt(encrypt(s, KEY), KEY)).toBe(s)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/storage/crypto.test.ts`
Expected: FAIL，报无法解析 `./crypto.js`

- [ ] **Step 3: 实现加密**

创建 `src/storage/crypto.ts`：

```typescript
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

/**
 * 凭证加密。AES-256-GCM，密文格式为 iv:authTag:ciphertext，三段均为 base64。
 *
 * 用 GCM 而非 CBC 是为了带认证标签：密文被篡改时解密会直接抛错，
 * 而不是解出一段垃圾数据被当成 token 拿去调 API。
 */
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM 推荐 96 位

export function encrypt(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decrypt(payload: string, keyHex: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('密文格式不合法')

  const decipher = createDecipheriv(ALGORITHM, Buffer.from(keyHex, 'hex'), Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/storage/crypto.test.ts`
Expected: PASS，6 个测试全绿

- [ ] **Step 5: 写存储的失败测试**

创建 `src/storage/credential.store.test.ts`：

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { Credential } from '../types.js'
import { openDb } from './db.js'
import { SqliteCredentialStore } from './credential.store.js'

const KEY = 'd'.repeat(64)

function makeCred(overrides: Partial<Credential> = {}): Credential {
  return {
    bizId: 'AOMI_SELF',
    platform: 'FACEBOOK',
    accessToken: 'page-token-abc',
    accountId: 'user-1',
    accountName: '澳觅',
    targetId: 'page-42',
    targetName: '澳觅官方主页',
    ...overrides,
  }
}

describe('SqliteCredentialStore', () => {
  let db: ReturnType<typeof openDb>
  let store: SqliteCredentialStore

  beforeEach(() => {
    db = openDb(':memory:')
    store = new SqliteCredentialStore(db, KEY)
  })

  afterEach(() => db.close())

  it('存进去能取出来', async () => {
    const cred = makeCred()
    await store.save(cred)
    expect(await store.get('AOMI_SELF', 'FACEBOOK')).toEqual(cred)
  })

  it('取不存在的凭证返回 null', async () => {
    expect(await store.get('NOBODY', 'FACEBOOK')).toBeNull()
  })

  it('accessToken 在库里是加密的', async () => {
    await store.save(makeCred())
    const row = db.prepare('SELECT access_token FROM credentials').get() as { access_token: string }
    expect(row.access_token).not.toContain('page-token-abc')
  })

  it('同一 bizId + platform 再存一次是覆盖，不是新增', async () => {
    await store.save(makeCred())
    await store.save(makeCred({ targetName: '改名了' }))
    const all = await store.list('AOMI_SELF')
    expect(all).toHaveLength(1)
    expect(all[0].targetName).toBe('改名了')
  })

  it('list 只返回该 bizId 的凭证', async () => {
    await store.save(makeCred())
    await store.save(makeCred({ bizId: 'STORE_9' }))
    expect(await store.list('AOMI_SELF')).toHaveLength(1)
  })

  it('remove 之后取不到', async () => {
    await store.save(makeCred())
    await store.remove('AOMI_SELF', 'FACEBOOK')
    expect(await store.get('AOMI_SELF', 'FACEBOOK')).toBeNull()
  })

  it('expiresAt 往返后仍是 Date 且时间相等', async () => {
    const expiresAt = new Date('2026-10-01T12:00:00.000Z')
    await store.save(makeCred({ platform: 'INSTAGRAM', expiresAt }))
    const got = await store.get('AOMI_SELF', 'INSTAGRAM')
    expect(got?.expiresAt).toBeInstanceOf(Date)
    expect(got?.expiresAt?.getTime()).toBe(expiresAt.getTime())
  })

  it('refreshToken 也加密，且可选字段缺省时为 undefined', async () => {
    await store.save(makeCred({ refreshToken: 'refresh-xyz' }))
    const row = db.prepare('SELECT refresh_token FROM credentials').get() as { refresh_token: string }
    expect(row.refresh_token).not.toContain('refresh-xyz')
    expect((await store.get('AOMI_SELF', 'FACEBOOK'))?.refreshToken).toBe('refresh-xyz')
  })
})
```

- [ ] **Step 6: 跑测试确认失败**

Run: `npm test src/storage/credential.store.test.ts`
Expected: FAIL，报无法解析 `./db.js`

- [ ] **Step 7: 实现 db.ts**

创建 `src/storage/db.ts`：

```typescript
import Database from 'better-sqlite3'

export type Db = Database.Database

/**
 * 打开数据库并建表。建表语句幂等，每次启动都跑一遍，不引入迁移框架。
 *
 * posts 表按 bizId 与 deal_id 建索引，是为了后续按门店与团单做归因聚合（设计文档 §9.3）。
 */
export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      biz_id        TEXT NOT NULL,
      platform      TEXT NOT NULL,
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      expires_at    INTEGER,
      account_id    TEXT NOT NULL,
      account_name  TEXT NOT NULL,
      target_id     TEXT NOT NULL,
      target_name   TEXT NOT NULL,
      PRIMARY KEY (biz_id, platform)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id            TEXT PRIMARY KEY,
      store_id      TEXT NOT NULL,
      deal_id       TEXT,
      language_code TEXT NOT NULL,
      payload       TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS posts (
      id           TEXT PRIMARY KEY,
      biz_id       TEXT NOT NULL,
      deal_id      TEXT,
      draft_id     TEXT,
      platform     TEXT NOT NULL,
      post_id      TEXT,
      permalink    TEXT,
      track_token  TEXT,
      status       TEXT NOT NULL,
      error        TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_posts_biz_created ON posts (biz_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_posts_deal ON posts (deal_id);
  `)

  return db
}
```

- [ ] **Step 8: 实现 credential.store.ts**

创建 `src/storage/credential.store.ts`：

```typescript
import type { Credential, Platform } from '../types.js'
import type { Db } from './db.js'
import { encrypt, decrypt } from './crypto.js'

/**
 * 凭证存储。
 *
 * accessToken 与 refreshToken 落盘前用 CREDENTIAL_ENCRYPTION_KEY 加密。
 */
export interface CredentialStore {
  save(cred: Credential): Promise<void>
  get(bizId: string, platform: Platform): Promise<Credential | null>
  list(bizId: string): Promise<Credential[]>
  remove(bizId: string, platform: Platform): Promise<void>
}

interface Row {
  biz_id: string
  platform: string
  access_token: string
  refresh_token: string | null
  expires_at: number | null
  account_id: string
  account_name: string
  target_id: string
  target_name: string
}

export class SqliteCredentialStore implements CredentialStore {
  constructor(
    private readonly db: Db,
    private readonly keyHex: string,
  ) {}

  private toCredential(row: Row): Credential {
    const cred: Credential = {
      bizId: row.biz_id,
      platform: row.platform as Platform,
      accessToken: decrypt(row.access_token, this.keyHex),
      accountId: row.account_id,
      accountName: row.account_name,
      targetId: row.target_id,
      targetName: row.target_name,
    }
    if (row.refresh_token) cred.refreshToken = decrypt(row.refresh_token, this.keyHex)
    if (row.expires_at !== null) cred.expiresAt = new Date(row.expires_at)
    return cred
  }

  async save(cred: Credential): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO credentials
           (biz_id, platform, access_token, refresh_token, expires_at,
            account_id, account_name, target_id, target_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (biz_id, platform) DO UPDATE SET
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           account_id = excluded.account_id,
           account_name = excluded.account_name,
           target_id = excluded.target_id,
           target_name = excluded.target_name`,
      )
      .run(
        cred.bizId,
        cred.platform,
        encrypt(cred.accessToken, this.keyHex),
        cred.refreshToken ? encrypt(cred.refreshToken, this.keyHex) : null,
        cred.expiresAt ? cred.expiresAt.getTime() : null,
        cred.accountId,
        cred.accountName,
        cred.targetId,
        cred.targetName,
      )
  }

  async get(bizId: string, platform: Platform): Promise<Credential | null> {
    const row = this.db
      .prepare('SELECT * FROM credentials WHERE biz_id = ? AND platform = ?')
      .get(bizId, platform) as Row | undefined
    return row ? this.toCredential(row) : null
  }

  async list(bizId: string): Promise<Credential[]> {
    const rows = this.db.prepare('SELECT * FROM credentials WHERE biz_id = ?').all(bizId) as Row[]
    return rows.map((r) => this.toCredential(r))
  }

  async remove(bizId: string, platform: Platform): Promise<void> {
    this.db.prepare('DELETE FROM credentials WHERE biz_id = ? AND platform = ?').run(bizId, platform)
  }
}

/** 内存实现，仅供测试使用。 */
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
```

- [ ] **Step 9: 删掉旧的内存实现文件**

```bash
git rm src/auth/credential.store.ts
```

`InMemoryCredentialStore` 已原样搬到 `src/storage/credential.store.ts`，没有其他文件 import 旧路径（Task 2 已确认 `registry.ts` 只引用 `types.js`）。

- [ ] **Step 10: 跑全量测试与类型检查**

Run: `npm run typecheck && npm test`
Expected: 全部通过，14 个测试

- [ ] **Step 11: 提交**

```bash
git add -A src/storage src/auth
git commit -m "feat: SQLite 存储层，凭证 AES-256-GCM 加密落盘

用 GCM 而非 CBC 是为了带认证标签——密文被篡改时直接抛错，
而不是解出垃圾数据被当成 token 拿去调 API。
posts 表按 biz_id 与 deal_id 建索引，为后续归因聚合预留。
InMemoryCredentialStore 保留供测试使用。"
```

---

### Task 4: 门店与团单数据源

**Files:**
- Create: `src/content/source.ts`
- Test: `src/content/source.test.ts`

**Interfaces:**
- Consumes: `Store`、`Deal`（Task 2）
- Produces:
  - `DataSource` 接口：`getStore(storeId): Promise<Store | null>`、`listStores(): Promise<Store[]>`、`listActiveDeals(storeId): Promise<Deal[]>`
  - `MockDataSource`，构造参数 `(stores: Store[], deals: Deal[])`
  - `MOCK_STORES: Store[]`、`MOCK_DEALS: Deal[]`
  - `createMockDataSource(): MockDataSource`

- [ ] **Step 1: 写失败的测试**

创建 `src/content/source.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { createMockDataSource, MOCK_STORES, MOCK_DEALS } from './source.js'

describe('MockDataSource', () => {
  const source = createMockDataSource()

  it('按 id 取到门店', async () => {
    const store = await source.getStore(MOCK_STORES[0].id)
    expect(store?.name).toBe(MOCK_STORES[0].name)
  })

  it('取不存在的门店返回 null', async () => {
    expect(await source.getStore('does-not-exist')).toBeNull()
  })

  it('列出全部门店', async () => {
    expect(await source.listStores()).toHaveLength(MOCK_STORES.length)
  })

  it('只返回该门店的团单', async () => {
    const deals = await source.listActiveDeals(MOCK_STORES[0].id)
    expect(deals.length).toBeGreaterThan(0)
    expect(deals.every((d) => d.storeId === MOCK_STORES[0].id)).toBe(true)
  })

  it('没有团单的门店返回空数组而非 null', async () => {
    expect(await source.listActiveDeals('does-not-exist')).toEqual([])
  })

  it('mock 数据里每个团单的现价低于原价', () => {
    expect(MOCK_DEALS.every((d) => d.priceCents < d.originalPriceCents)).toBe(true)
  })

  it('mock 数据里每个团单都挂在真实存在的门店上', () => {
    const ids = new Set(MOCK_STORES.map((s) => s.id))
    expect(MOCK_DEALS.every((d) => ids.has(d.storeId))).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/content/source.test.ts`
Expected: FAIL，报无法解析 `./source.js`

- [ ] **Step 3: 实现**

创建 `src/content/source.ts`：

```typescript
import type { Store, Deal } from '../types.js'

/**
 * 门店与团单数据源。
 *
 * Plan 1 用 MockDataSource 跑通链路，接澳觅内部 API 时只换实现。
 * 这个接口有两个用途：内容生成取数，以及后续评论托管起草回复时
 * 读营业时间与团单库存（设计文档 §9.2）。
 */
export interface DataSource {
  getStore(storeId: string): Promise<Store | null>
  listStores(): Promise<Store[]>
  listActiveDeals(storeId: string): Promise<Deal[]>
}

export const MOCK_STORES: Store[] = [
  {
    id: 'store-001',
    name: '恒友咖喱鱼蛋',
    address: '澳门大堂巷 12 号',
    phone: '+853 2857 3277',
    businessHours: '11:00-22:00',
    category: '小食',
  },
  {
    id: 'store-002',
    name: '安德鲁饼店',
    address: '澳门路环挞沙街 1 号',
    phone: '+853 2888 2534',
    businessHours: '07:00-22:00',
    category: '烘焙',
  },
  {
    id: 'store-003',
    name: '陈光记饭店',
    address: '澳门羅保博士街 19 号',
    businessHours: '12:00-23:30',
    category: '粤菜',
  },
]

export const MOCK_DEALS: Deal[] = [
  {
    id: 'deal-001',
    storeId: 'store-001',
    title: '咖喱鱼蛋双人餐',
    priceCents: 5800,
    originalPriceCents: 8800,
    description: '咖喱鱼蛋两份、猪皮萝卜一份、冻柠茶两杯',
    imageUrls: ['https://picsum.photos/seed/fishball/1080/1080'],
  },
  {
    id: 'deal-002',
    storeId: 'store-002',
    title: '葡挞六个装',
    priceCents: 6600,
    originalPriceCents: 8400,
    description: '经典葡式蛋挞六个，现烤出炉',
    imageUrls: ['https://picsum.photos/seed/eggtart/1080/1080'],
  },
  {
    id: 'deal-003',
    storeId: 'store-003',
    title: '烧味双拼饭',
    priceCents: 7800,
    originalPriceCents: 9800,
    description: '烧鹅配叉烧双拼饭一份，例汤一碗',
    imageUrls: ['https://picsum.photos/seed/roastgoose/1080/1080'],
  },
]

export class MockDataSource implements DataSource {
  constructor(
    private readonly stores: Store[],
    private readonly deals: Deal[],
  ) {}

  async getStore(storeId: string): Promise<Store | null> {
    return this.stores.find((s) => s.id === storeId) ?? null
  }

  async listStores(): Promise<Store[]> {
    return [...this.stores]
  }

  async listActiveDeals(storeId: string): Promise<Deal[]> {
    return this.deals.filter((d) => d.storeId === storeId)
  }
}

export function createMockDataSource(): MockDataSource {
  return new MockDataSource(MOCK_STORES, MOCK_DEALS)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/content/source.test.ts`
Expected: PASS，7 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/content/source.ts src/content/source.test.ts
git commit -m "feat: 门店与团单数据源，先用 mock

DataSource 接口有两个用途：内容生成取数，以及后续评论托管
起草回复时读营业时间与团单库存。接澳觅 API 时只换实现。"
```

---

### Task 5: 内容生成层

**Files:**
- Create: `src/content/prompts.ts`
- Create: `src/content/generator.ts`
- Test: `src/content/generator.test.ts`

**Interfaces:**
- Consumes: `Store`、`Deal`、`ContentDraft`（Task 2）
- Produces:
  - `TextCompletion` 接口：`complete(system: string, user: string): Promise<string>`
  - `ClaudeTextCompletion`（实现，调 `@anthropic-ai/sdk`）
  - `buildPrompt(store: Store, deal?: Deal): { system: string; user: string }`
  - `ContentGenerator`，构造参数 `(completion: TextCompletion)`，方法 `generate(store: Store, deal?: Deal): Promise<ContentDraft>`

- [ ] **Step 1: 写失败的测试**

创建 `src/content/generator.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { Store, Deal } from '../types.js'
import { ContentGenerator, type TextCompletion } from './generator.js'
import { buildPrompt } from './prompts.js'

const STORE: Store = {
  id: 'store-001',
  name: '恒友咖喱鱼蛋',
  address: '澳门大堂巷 12 号',
  phone: '+853 2857 3277',
  businessHours: '11:00-22:00',
  category: '小食',
}

const DEAL: Deal = {
  id: 'deal-001',
  storeId: 'store-001',
  title: '咖喱鱼蛋双人餐',
  priceCents: 5800,
  originalPriceCents: 8800,
  description: '咖喱鱼蛋两份、猪皮萝卜一份、冻柠茶两杯',
  imageUrls: ['https://example.com/a.jpg'],
}

/** 返回固定 JSON 的假模型，让生成层可以完全离线测试。 */
function fakeCompletion(json: unknown): TextCompletion {
  return { async complete() { return JSON.stringify(json) } }
}

const GOOD = { headline: '大堂巷的咖喱鱼蛋，两个人 58 蚊', text: '正文内容……' }

describe('buildPrompt', () => {
  it('提示词里带上门店名与地址', () => {
    const { user } = buildPrompt(STORE)
    expect(user).toContain('恒友咖喱鱼蛋')
    expect(user).toContain('澳门大堂巷 12 号')
  })

  it('有团单时带上标题与两个价格，且换算成元', () => {
    const { user } = buildPrompt(STORE, DEAL)
    expect(user).toContain('咖喱鱼蛋双人餐')
    expect(user).toContain('58.00')
    expect(user).toContain('88.00')
  })

  it('没有团单时不出现价格字样', () => {
    expect(buildPrompt(STORE).user).not.toContain('现价')
  })

  it('系统提示要求简体中文并禁止编造', () => {
    const { system } = buildPrompt(STORE, DEAL)
    expect(system).toContain('简体中文')
    expect(system).toContain('不要编造')
  })
})

describe('ContentGenerator', () => {
  it('把模型返回解析成 ContentDraft', async () => {
    const draft = await new ContentGenerator(fakeCompletion(GOOD)).generate(STORE, DEAL)
    expect(draft.headline).toBe(GOOD.headline)
    expect(draft.text).toBe(GOOD.text)
  })

  it('languageCode 恒为 zh-CN', async () => {
    const draft = await new ContentGenerator(fakeCompletion(GOOD)).generate(STORE, DEAL)
    expect(draft.languageCode).toBe('zh-CN')
  })

  it('图片取自团单，不由模型生成', async () => {
    const draft = await new ContentGenerator(fakeCompletion(GOOD)).generate(STORE, DEAL)
    expect(draft.imageUrls).toEqual(DEAL.imageUrls)
  })

  it('带上 storeId 与 dealId 供后续归因', async () => {
    const draft = await new ContentGenerator(fakeCompletion(GOOD)).generate(STORE, DEAL)
    expect(draft.storeId).toBe('store-001')
    expect(draft.dealId).toBe('deal-001')
  })

  it('没有团单时 dealId 为 undefined，图片为空数组', async () => {
    const draft = await new ContentGenerator(fakeCompletion(GOOD)).generate(STORE)
    expect(draft.dealId).toBeUndefined()
    expect(draft.imageUrls).toEqual([])
  })

  it('模型返回非 JSON 时抛出可读错误', async () => {
    const bad: TextCompletion = { async complete() { return '我不太确定' } }
    await expect(new ContentGenerator(bad).generate(STORE, DEAL)).rejects.toThrow(/不是合法 JSON/)
  })

  it('模型返回缺字段时抛出并指出缺哪个', async () => {
    const gen = new ContentGenerator(fakeCompletion({ headline: '只有标题' }))
    await expect(gen.generate(STORE, DEAL)).rejects.toThrow(/text/)
  })

  it('容忍模型把 JSON 包在 ```json 代码块里', async () => {
    const fenced: TextCompletion = {
      async complete() { return '```json\n' + JSON.stringify(GOOD) + '\n```' },
    }
    expect((await new ContentGenerator(fenced).generate(STORE, DEAL)).headline).toBe(GOOD.headline)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/content/generator.test.ts`
Expected: FAIL，报无法解析 `./generator.js`

- [ ] **Step 3: 实现提示词**

创建 `src/content/prompts.ts`：

```typescript
import type { Store, Deal } from '../types.js'

/** 分转元，保留两位小数。用整数分存价格是为了避免浮点误差。 */
function yuan(cents: number): string {
  return (cents / 100).toFixed(2)
}

/**
 * 构造生成文案的提示词。
 *
 * 只喂真实字段，并明确禁止编造——门店信息会被发到公域，
 * 编出来的营业时间或菜品是会产生实际后果的。
 */
export function buildPrompt(store: Store, deal?: Deal): { system: string; user: string } {
  const system = [
    '你是澳门本地生活平台「澳觅」的社交媒体文案编辑。',
    '为门店撰写发布到 Facebook 的推广文案。',
    '',
    '要求：',
    '- 用简体中文写作。',
    '- 只使用下面提供的门店与团单信息，不要编造任何未给出的事实——',
    '  营业时间、菜品、价格、地址若未提供就不要提。',
    '- 语气亲切自然，像本地人推荐，不要用夸张的营销腔。',
    '- 正文控制在 200 字以内。',
    '- 不要自己加话题标签，不要加外链。',
    '',
    '只输出一个 JSON 对象，不要有任何其他文字：',
    '{"headline": "一句话标题，20 字以内", "text": "正文"}',
  ].join('\n')

  const lines = [
    `门店名称：${store.name}`,
    `地址：${store.address}`,
    `品类：${store.category}`,
  ]
  if (store.businessHours) lines.push(`营业时间：${store.businessHours}`)
  if (store.phone) lines.push(`电话：${store.phone}`)

  if (deal) {
    lines.push(
      '',
      `团单：${deal.title}`,
      `团单内容：${deal.description}`,
      `现价：${yuan(deal.priceCents)} 澳门元`,
      `原价：${yuan(deal.originalPriceCents)} 澳门元`,
    )
  }

  return { system, user: lines.join('\n') }
}
```

- [ ] **Step 4: 实现生成器**

创建 `src/content/generator.ts`：

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { Store, Deal, ContentDraft } from '../types.js'
import { buildPrompt } from './prompts.js'

/**
 * 文本补全端口。
 *
 * 把模型调用抽成接口，是为了让生成层可以完全离线单测——
 * 测试注入返回固定 JSON 的假实现，不需要 API key 也不花钱。
 */
export interface TextCompletion {
  complete(system: string, user: string): Promise<string>
}

/** 真实实现：调 Claude。 */
export class ClaudeTextCompletion implements TextCompletion {
  private readonly client: Anthropic

  constructor(client: Anthropic = new Anthropic()) {
    this.client = client
  }

  async complete(system: string, user: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system,
      // 写文案属于常规任务，用 medium 档；adaptive 思考让模型自己决定深度
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      messages: [{ role: 'user', content: user }],
    })

    // response.content 是可辨识联合，必须先按 type 收窄才能读 .text
    const parts: string[] = []
    for (const block of response.content) {
      if (block.type === 'text') parts.push(block.text)
    }
    return parts.join('')
  }
}

/** 剥掉模型有时会加上的 ```json 代码块围栏。 */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/)
  return match ? match[1].trim() : trimmed
}

export class ContentGenerator {
  constructor(private readonly completion: TextCompletion) {}

  async generate(store: Store, deal?: Deal): Promise<ContentDraft> {
    const { system, user } = buildPrompt(store, deal)
    const raw = await this.completion.complete(system, user)

    let parsed: unknown
    try {
      parsed = JSON.parse(stripFence(raw))
    } catch {
      throw new Error(`模型返回的不是合法 JSON：${raw.slice(0, 200)}`)
    }

    const obj = parsed as Record<string, unknown>
    for (const field of ['headline', 'text']) {
      if (typeof obj[field] !== 'string' || !obj[field]) {
        throw new Error(`模型返回缺少字段 ${field}`)
      }
    }

    const draft: ContentDraft = {
      storeId: store.id,
      languageCode: 'zh-CN', // v1 单语言，见设计文档 §3.1
      headline: obj.headline as string,
      text: obj.text as string,
      // 图片来自团单的真实照片，不由模型生成
      imageUrls: deal ? [...deal.imageUrls] : [],
    }
    if (deal) draft.dealId = deal.id

    return draft
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test src/content/generator.test.ts`
Expected: PASS，12 个测试全绿

- [ ] **Step 6: 类型检查**

Run: `npm run typecheck`
Expected: 通过。若 `output_config` 或 `thinking` 报类型错，说明 SDK 版本与本计划假设不符——查看 `node_modules/@anthropic-ai/sdk` 的类型定义，按实际字段名调整，不要删掉这两个参数。

- [ ] **Step 7: 提交**

```bash
git add src/content/prompts.ts src/content/generator.ts src/content/generator.test.ts
git commit -m "feat: 内容生成层，Claude 出文案

模型调用抽成 TextCompletion 端口，生成层可完全离线单测。
提示词明确禁止编造——门店信息要发到公域，编出来的
营业时间或菜品会产生实际后果。图片取自团单真实照片。
容忍模型把 JSON 包在代码块里。"
```

---

### Task 6: Facebook Transport 与错误映射

**Files:**
- Create: `src/platforms/facebook/transport.ts`
- Test: `src/platforms/facebook/transport.test.ts`

**Interfaces:**
- Consumes: `PublishError`（`src/publishing/errors.js`）、`Config`（Task 1）
- Produces:
  - `FacebookTransport` 接口：`get<T>(path: string, params: Record<string, string>): Promise<T>`、`post<T>(path: string, params: Record<string, string>): Promise<T>`
  - `HttpFacebookTransport`，构造参数 `(graphVersion: string, fetchImpl?: typeof fetch)`
  - `FakeFacebookTransport`（测试用），构造参数 `(responses: Record<string, unknown>)`，属性 `calls: { method: string; path: string; params: Record<string, string> }[]`

- [ ] **Step 1: 写失败的测试**

创建 `src/platforms/facebook/transport.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { HttpFacebookTransport } from './transport.js'
import { PublishError } from '../../publishing/errors.js'

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('HttpFacebookTransport', () => {
  it('把 graph 版本拼进 URL', async () => {
    let seen = ''
    const spy = (async (url: string | URL) => {
      seen = String(url)
      return new Response('{"id":"1"}', { status: 200 })
    }) as unknown as typeof fetch

    await new HttpFacebookTransport('v26.0', spy).get('/me', { access_token: 't' })
    expect(seen).toContain('https://graph.facebook.com/v26.0/me')
    expect(seen).toContain('access_token=t')
  })

  it('POST 时参数放在 body 里，不出现在 URL 上', async () => {
    let seenUrl = ''
    let seenBody = ''
    const spy = (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url)
      seenBody = String(init?.body ?? '')
      return new Response('{"id":"1"}', { status: 200 })
    }) as unknown as typeof fetch

    await new HttpFacebookTransport('v26.0', spy).post('/page-42/feed', {
      message: '你好',
      access_token: 'secret-token',
    })
    expect(seenUrl).not.toContain('secret-token')
    expect(seenBody).toContain('secret-token')
    expect(seenBody).toContain(encodeURIComponent('你好'))
  })

  it('200 时返回解析后的 JSON', async () => {
    const t = new HttpFacebookTransport('v26.0', fakeFetch(200, { id: 'post-1' }))
    expect(await t.get<{ id: string }>('/x', {})).toEqual({ id: 'post-1' })
  })

  it('429 抛出可重试的 PublishError', async () => {
    const t = new HttpFacebookTransport('v26.0', fakeFetch(429, { error: { message: '限流' } }))
    await expect(t.get('/x', {})).rejects.toMatchObject({ retryable: true })
  })

  it('500 抛出可重试的 PublishError', async () => {
    const t = new HttpFacebookTransport('v26.0', fakeFetch(500, { error: { message: '崩了' } }))
    await expect(t.get('/x', {})).rejects.toMatchObject({ retryable: true })
  })

  it('400 抛出不可重试的 PublishError，并带上 Graph 的错误消息', async () => {
    const t = new HttpFacebookTransport('v26.0', fakeFetch(400, { error: { message: '参数不合法' } }))
    await expect(t.get('/x', {})).rejects.toThrow(/参数不合法/)
    await expect(t.get('/x', {})).rejects.toMatchObject({ retryable: false })
  })

  it('抛的是 PublishError 而不是普通 Error', async () => {
    const t = new HttpFacebookTransport('v26.0', fakeFetch(400, { error: { message: 'x' } }))
    await expect(t.get('/x', {})).rejects.toBeInstanceOf(PublishError)
  })

  it('响应体不是 JSON 时也能给出可读错误', async () => {
    const bad = (async () => new Response('<html>502</html>', { status: 502 })) as unknown as typeof fetch
    await expect(new HttpFacebookTransport('v26.0', bad).get('/x', {})).rejects.toMatchObject({
      retryable: true,
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/platforms/facebook/transport.test.ts`
Expected: FAIL，报无法解析 `./transport.js`

- [ ] **Step 3: 实现**

创建 `src/platforms/facebook/transport.ts`：

```typescript
import { PublishError } from '../../publishing/errors.js'

/**
 * Facebook Graph API 的 HTTP 封装。
 *
 * 抽成接口是为了让适配器可以离线单测——测试注入 FakeFacebookTransport，
 * 不需要真实 token 也不会打到 Meta 的服务器。
 */
export interface FacebookTransport {
  get<T>(path: string, params: Record<string, string>): Promise<T>
  post<T>(path: string, params: Record<string, string>): Promise<T>
}

const BASE = 'https://graph.facebook.com'

interface GraphErrorBody {
  error?: { message?: string; code?: number; type?: string }
}

export class HttpFacebookTransport implements FacebookTransport {
  constructor(
    private readonly graphVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async handle<T>(res: Response, path: string): Promise<T> {
    const raw = await res.text()

    if (res.ok) {
      return JSON.parse(raw) as T
    }

    // 出错时响应体不一定是 JSON（网关的 HTML 错误页），解析失败就退回原始文本
    let message = raw.slice(0, 200)
    let detail: unknown = raw
    try {
      const body = JSON.parse(raw) as GraphErrorBody
      detail = body
      if (body.error?.message) message = body.error.message
    } catch {
      // 保持退回值
    }

    throw PublishError.fromHttpStatus(res.status, `Facebook ${path}：${message}`, detail)
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${BASE}/${this.graphVersion}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    return this.handle<T>(await this.fetchImpl(url), path)
  }

  async post<T>(path: string, params: Record<string, string>): Promise<T> {
    // token 放 body 而非 query，避免出现在日志与 Referer 里
    const res = await this.fetchImpl(`${BASE}/${this.graphVersion}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    })
    return this.handle<T>(res, path)
  }
}

/** 测试用的假 Transport：按 `METHOD path` 查表返回，并记录全部调用。 */
export class FakeFacebookTransport implements FacebookTransport {
  readonly calls: { method: string; path: string; params: Record<string, string> }[] = []

  constructor(private readonly responses: Record<string, unknown>) {}

  private lookup<T>(method: string, path: string, params: Record<string, string>): T {
    this.calls.push({ method, path, params })
    const key = `${method} ${path}`
    if (!(key in this.responses)) throw new Error(`FakeFacebookTransport 没有为 ${key} 配置响应`)
    return this.responses[key] as T
  }

  async get<T>(path: string, params: Record<string, string>): Promise<T> {
    return this.lookup<T>('GET', path, params)
  }

  async post<T>(path: string, params: Record<string, string>): Promise<T> {
    return this.lookup<T>('POST', path, params)
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/platforms/facebook/transport.test.ts`
Expected: PASS，8 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/platforms/facebook/transport.ts src/platforms/facebook/transport.test.ts
git commit -m "feat: Facebook Transport 与错误映射

HTTP 调用封装在接口后，适配器因此可以离线单测。
POST 的 token 放 body 不放 query，避免出现在日志与 Referer 里。
出错时响应体不一定是 JSON，网关的 HTML 错误页也要能给出可读错误。"
```

---

### Task 7: Facebook 的 format 与 validate（纯函数）

**Files:**
- Create: `src/platforms/facebook/format.ts`
- Test: `src/platforms/facebook/format.test.ts`

**Interfaces:**
- Consumes: `ContentDraft`、`PublishTask`、`PublishValidationIssue`（Task 2）
- Produces:
  - `formatForFacebook(draft: ContentDraft, bizId: string): PublishTask`
  - `validateFacebookTask(task: PublishTask): PublishValidationIssue[]`
  - `FACEBOOK_MAX_TEXT_LENGTH = 63206`

- [ ] **Step 1: 写失败的测试**

创建 `src/platforms/facebook/format.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { ContentDraft, PublishTask } from '../../types.js'
import { formatForFacebook, validateFacebookTask, FACEBOOK_MAX_TEXT_LENGTH } from './format.js'

function draft(overrides: Partial<ContentDraft> = {}): ContentDraft {
  return {
    storeId: 'store-001',
    dealId: 'deal-001',
    languageCode: 'zh-CN',
    headline: '大堂巷的咖喱鱼蛋',
    text: '正文内容。',
    imageUrls: ['https://example.com/a.jpg'],
    ...overrides,
  }
}

describe('formatForFacebook', () => {
  it('标题与正文都进 text，标题在前', () => {
    const task = formatForFacebook(draft(), 'AOMI_SELF')
    expect(task.text.indexOf('大堂巷的咖喱鱼蛋')).toBeLessThan(task.text.indexOf('正文内容。'))
  })

  it('平台为 FACEBOOK，bizId 透传', () => {
    const task = formatForFacebook(draft(), 'STORE_9')
    expect(task.platform).toBe('FACEBOOK')
    expect(task.bizId).toBe('STORE_9')
  })

  it('图片透传到 mediaUrls', () => {
    expect(formatForFacebook(draft(), 'AOMI_SELF').mediaUrls).toEqual(['https://example.com/a.jpg'])
  })

  it('callToAction 拼到正文尾部——Facebook 正文外链可点', () => {
    const task = formatForFacebook(
      draft({ callToAction: { label: '立即抢购', url: 'https://aomi.example/d/1' } }),
      'AOMI_SELF',
    )
    expect(task.text).toContain('立即抢购')
    expect(task.text).toContain('https://aomi.example/d/1')
    expect(task.text.trimEnd().endsWith('https://aomi.example/d/1')).toBe(true)
  })

  it('没有 callToAction 时正文不带链接', () => {
    expect(formatForFacebook(draft(), 'AOMI_SELF').text).not.toContain('http')
  })

  it('languageCode 透传', () => {
    expect(formatForFacebook(draft(), 'AOMI_SELF').languageCode).toBe('zh-CN')
  })

  it('offer 不透传——Facebook 没有结构化优惠字段', () => {
    const task = formatForFacebook(
      draft({ offer: { couponCode: 'ABC', redeemUrl: 'https://x', terms: '不可叠加' } }),
      'AOMI_SELF',
    )
    expect(task.offer).toBeUndefined()
  })

  it('是纯函数——不修改传入的 draft', () => {
    const d = draft()
    const before = JSON.stringify(d)
    formatForFacebook(d, 'AOMI_SELF')
    expect(JSON.stringify(d)).toBe(before)
  })
})

function task(overrides: Partial<PublishTask> = {}): PublishTask {
  return { bizId: 'AOMI_SELF', platform: 'FACEBOOK', text: '有内容', ...overrides }
}

describe('validateFacebookTask', () => {
  it('正常任务没有问题', () => {
    expect(validateFacebookTask(task())).toEqual([])
  })

  it('正文与图片都为空时报错', () => {
    const issues = validateFacebookTask(task({ text: '   ', mediaUrls: [] }))
    expect(issues).toHaveLength(1)
    expect(issues[0].field).toBe('text')
  })

  it('正文为空但有图片是允许的——纯图片帖', () => {
    expect(validateFacebookTask(task({ text: '', mediaUrls: ['https://x/a.jpg'] }))).toEqual([])
  })

  it('正文超长时报错并指出上限', () => {
    const issues = validateFacebookTask(task({ text: 'a'.repeat(FACEBOOK_MAX_TEXT_LENGTH + 1) }))
    expect(issues.some((i) => i.field === 'text' && i.message.includes(String(FACEBOOK_MAX_TEXT_LENGTH)))).toBe(true)
  })

  it('图片地址不是 http(s) 时报错', () => {
    const issues = validateFacebookTask(task({ mediaUrls: ['ftp://x/a.jpg'] }))
    expect(issues.some((i) => i.field === 'mediaUrls')).toBe(true)
  })

  it('多个问题会一次全部报出，而不是只报第一个', () => {
    const issues = validateFacebookTask(task({ text: '', mediaUrls: ['not-a-url'] }))
    expect(issues.length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/platforms/facebook/format.test.ts`
Expected: FAIL，报无法解析 `./format.js`

- [ ] **Step 3: 实现**

创建 `src/platforms/facebook/format.ts`：

```typescript
import type { ContentDraft, PublishTask, PublishValidationIssue } from '../../types.js'

/** Facebook 帖子正文上限。 */
export const FACEBOOK_MAX_TEXT_LENGTH = 63206

/**
 * 中性素材包 → Facebook 发布任务。
 *
 * 纯函数，无 IO。这是保住「接一个新平台 ≈ 三个接口」的关键：
 * 生成层不按平台分叉，差异全部收在这里。
 */
export function formatForFacebook(draft: ContentDraft, bizId: string): PublishTask {
  const parts = [draft.headline, '', draft.text]

  // Facebook 正文里的外链可点，所以直接拼在尾部
  if (draft.callToAction) {
    parts.push('', `${draft.callToAction.label}：${draft.callToAction.url}`)
  }

  const task: PublishTask = {
    bizId,
    platform: 'FACEBOOK',
    text: parts.join('\n'),
    mediaUrls: [...draft.imageUrls],
    languageCode: draft.languageCode,
  }

  // 刻意不透传 draft.offer：Facebook 没有结构化优惠字段，
  // 传了也没地方放，只有 Google 的 localPost 能原生承载。
  return task
}

function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * 发布前校验。同步纯函数，在发起请求之前报错，不消耗 API 配额。
 * 一次返回全部问题，而不是遇到第一个就返回。
 */
export function validateFacebookTask(task: PublishTask): PublishValidationIssue[] {
  const issues: PublishValidationIssue[] = []
  const media = task.mediaUrls ?? []

  if (!task.text.trim() && media.length === 0) {
    issues.push({ field: 'text', message: '正文与图片不能同时为空' })
  }

  if (task.text.length > FACEBOOK_MAX_TEXT_LENGTH) {
    issues.push({
      field: 'text',
      message: `正文超长：${task.text.length} 字符，上限 ${FACEBOOK_MAX_TEXT_LENGTH}`,
    })
  }

  for (const url of media) {
    if (!isHttpUrl(url)) {
      issues.push({ field: 'mediaUrls', message: `图片地址必须是 http(s)：${url}` })
    }
  }

  return issues
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/platforms/facebook/format.test.ts`
Expected: PASS，14 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/platforms/facebook/format.ts src/platforms/facebook/format.test.ts
git commit -m "feat: Facebook 的 format 与 validate，纯函数

format 是保住「接一个新平台 ≈ 三个接口」的关键：生成层不按
平台分叉，差异全部收在这个无 IO 的纯函数里。
刻意不透传 offer——Facebook 没有结构化优惠字段。
validate 一次返回全部问题，在消耗 API 配额之前报错。"
```

---

### Task 8: Facebook 授权

**Files:**
- Create: `src/platforms/facebook/auth.ts`
- Test: `src/platforms/facebook/auth.test.ts`

**Interfaces:**
- Consumes: `Credential`、`PlatformAuth`（Task 2）、`FacebookTransport`（Task 6）、`CredentialStore`（Task 3）
- Produces:
  - `FACEBOOK_SCOPES: string[]`
  - `FacebookAuth implements PlatformAuth`，构造参数
    `(transport: FacebookTransport, store: CredentialStore, opts: { appId: string; appSecret: string; redirectUri: string })`

- [ ] **Step 1: 写失败的测试**

创建 `src/platforms/facebook/auth.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryCredentialStore } from '../../storage/credential.store.js'
import { FakeFacebookTransport } from './transport.js'
import { FacebookAuth, FACEBOOK_SCOPES } from './auth.js'

const OPTS = {
  appId: 'app-123',
  appSecret: 'secret-456',
  redirectUri: 'http://localhost:3000/auth/meta/callback',
}

function makeAuth(responses: Record<string, unknown> = {}) {
  const store = new InMemoryCredentialStore()
  const transport = new FakeFacebookTransport({
    'GET /oauth/access_token': { access_token: 'user-token' },
    'GET /me/accounts': {
      data: [{ id: 'page-42', name: '澳觅官方主页', access_token: 'page-token' }],
    },
    'GET /me': { id: 'user-1', name: '澳觅' },
    ...responses,
  })
  return { auth: new FacebookAuth(transport, store, OPTS), store, transport }
}

describe('FacebookAuth.getAuthUrl', () => {
  it('URL 指向 Facebook 授权端点并带上 appId 与回调地址', async () => {
    const { auth } = makeAuth()
    const { url } = await auth.getAuthUrl('AOMI_SELF')
    expect(url).toContain('facebook.com')
    expect(url).toContain('client_id=app-123')
    expect(url).toContain(encodeURIComponent(OPTS.redirectUri))
  })

  it('带上全部所需权限', async () => {
    const { auth } = makeAuth()
    const { url } = await auth.getAuthUrl('AOMI_SELF')
    for (const scope of FACEBOOK_SCOPES) expect(decodeURIComponent(url)).toContain(scope)
  })

  it('每次生成的 state 不同，且 URL 里带上了它', async () => {
    const { auth } = makeAuth()
    const a = await auth.getAuthUrl('AOMI_SELF')
    const b = await auth.getAuthUrl('AOMI_SELF')
    expect(a.state).not.toBe(b.state)
    expect(a.url).toContain(`state=${a.state}`)
  })

  it('权限清单包含发帖与管理评论', () => {
    expect(FACEBOOK_SCOPES).toContain('pages_manage_posts')
    expect(FACEBOOK_SCOPES).toContain('pages_manage_engagement')
  })
})

describe('FacebookAuth.handleCallback', () => {
  let ctx: ReturnType<typeof makeAuth>

  beforeEach(() => { ctx = makeAuth() })

  it('未知的 state 直接拒绝', async () => {
    await expect(ctx.auth.handleCallback('code-1', 'never-issued')).rejects.toThrow(/state/)
  })

  it('走完流程后返回 Page 凭证', async () => {
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    const cred = await ctx.auth.handleCallback('code-1', state)
    expect(cred.platform).toBe('FACEBOOK')
    expect(cred.bizId).toBe('AOMI_SELF')
    expect(cred.targetId).toBe('page-42')
    expect(cred.targetName).toBe('澳觅官方主页')
  })

  it('存的是 Page token 而不是 User token', async () => {
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    const cred = await ctx.auth.handleCallback('code-1', state)
    expect(cred.accessToken).toBe('page-token')
  })

  it('Page token 不过期，expiresAt 为空', async () => {
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    const cred = await ctx.auth.handleCallback('code-1', state)
    expect(cred.expiresAt).toBeUndefined()
  })

  it('凭证已落库', async () => {
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    await ctx.auth.handleCallback('code-1', state)
    expect(await ctx.store.get('AOMI_SELF', 'FACEBOOK')).not.toBeNull()
  })

  it('state 只能用一次', async () => {
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    await ctx.auth.handleCallback('code-1', state)
    await expect(ctx.auth.handleCallback('code-2', state)).rejects.toThrow(/state/)
  })

  it('账号下没有主页时报出可读错误', async () => {
    const bad = makeAuth({ 'GET /me/accounts': { data: [] } })
    const { state } = await bad.auth.getAuthUrl('AOMI_SELF')
    await expect(bad.auth.handleCallback('code-1', state)).rejects.toThrow(/没有可管理的主页/)
  })
})

describe('FacebookAuth.getValidAccessToken', () => {
  it('Page token 不过期，直接返回不刷新', async () => {
    const ctx = makeAuth()
    const { state } = await ctx.auth.getAuthUrl('AOMI_SELF')
    await ctx.auth.handleCallback('code-1', state)

    const before = ctx.transport.calls.length
    expect(await ctx.auth.getValidAccessToken('AOMI_SELF')).toBe('page-token')
    expect(ctx.transport.calls.length).toBe(before) // 没有发生任何刷新请求
  })

  it('没有凭证时报出可读错误', async () => {
    await expect(makeAuth().auth.getValidAccessToken('NOBODY')).rejects.toThrow(/未绑定/)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/platforms/facebook/auth.test.ts`
Expected: FAIL，报无法解析 `./auth.js`

- [ ] **Step 3: 实现**

创建 `src/platforms/facebook/auth.ts`：

```typescript
import { randomBytes } from 'node:crypto'
import type { Credential, PlatformAuth } from '../../types.js'
import type { CredentialStore } from '../../storage/credential.store.js'
import type { FacebookTransport } from './transport.js'

/**
 * 所需权限。全部需要 App Review，但开发者模式下对有角色的用户免审。
 * 注意：开发模式产生的数据只对 Administrator / Developer / Tester /
 * Analytics User 可见（设计文档 §4）。
 */
export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
  'pages_manage_metadata',
  'read_insights',
]

interface TokenResponse {
  access_token: string
}

interface AccountsResponse {
  data: { id: string; name: string; access_token: string }[]
}

interface MeResponse {
  id: string
  name: string
}

export class FacebookAuth implements PlatformAuth {
  /** state → bizId。一次性，用完即删，防重放。 */
  private readonly pendingStates = new Map<string, string>()

  constructor(
    private readonly transport: FacebookTransport,
    private readonly store: CredentialStore,
    private readonly opts: { appId: string; appSecret: string; redirectUri: string },
  ) {}

  async getAuthUrl(bizId: string): Promise<{ url: string; state: string }> {
    const state = randomBytes(16).toString('hex')
    this.pendingStates.set(state, bizId)

    const url = new URL('https://www.facebook.com/v26.0/dialog/oauth')
    url.searchParams.set('client_id', this.opts.appId)
    url.searchParams.set('redirect_uri', this.opts.redirectUri)
    url.searchParams.set('scope', FACEBOOK_SCOPES.join(','))
    url.searchParams.set('state', state)
    url.searchParams.set('response_type', 'code')

    return { url: url.toString(), state }
  }

  async handleCallback(code: string, state: string): Promise<Credential> {
    const bizId = this.pendingStates.get(state)
    if (!bizId) throw new Error('state 无效或已使用')
    this.pendingStates.delete(state)

    const token = await this.transport.get<TokenResponse>('/oauth/access_token', {
      client_id: this.opts.appId,
      client_secret: this.opts.appSecret,
      redirect_uri: this.opts.redirectUri,
      code,
    })

    const me = await this.transport.get<MeResponse>('/me', {
      access_token: token.access_token,
      fields: 'id,name',
    })

    const accounts = await this.transport.get<AccountsResponse>('/me/accounts', {
      access_token: token.access_token,
      fields: 'id,name,access_token',
    })

    const page = accounts.data[0]
    if (!page) throw new Error('该账号下没有可管理的主页')

    // Page token 不过期，因此不设 expiresAt——刷新逻辑要按 token 类型分别处理，
    // 60 天只对 User token 与 IG token 成立。
    const cred: Credential = {
      bizId,
      platform: 'FACEBOOK',
      accessToken: page.access_token,
      accountId: me.id,
      accountName: me.name,
      targetId: page.id,
      targetName: page.name,
    }

    await this.store.save(cred)
    return cred
  }

  async getValidAccessToken(bizId: string): Promise<string> {
    const cred = await this.store.get(bizId, 'FACEBOOK')
    if (!cred) throw new Error(`${bizId} 尚未绑定 Facebook`)
    // Page token 不过期，无需刷新
    return cred.accessToken
  }

  async getAccountInfo(bizId: string): Promise<{ name: string; avatar?: string }> {
    const cred = await this.store.get(bizId, 'FACEBOOK')
    if (!cred) throw new Error(`${bizId} 尚未绑定 Facebook`)
    return { name: cred.targetName }
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/platforms/facebook/auth.test.ts`
Expected: PASS，13 个测试全绿

- [ ] **Step 5: 提交**

```bash
git add src/platforms/facebook/auth.ts src/platforms/facebook/auth.test.ts
git commit -m "feat: Facebook OAuth 授权

存的是 Page token 而不是 User token，且不设 expiresAt——
Page token 不过期，刷新逻辑必须按 token 类型分叉，
60 天只对 User token 与 IG token 成立。
state 一次性，用完即删。"
```

---

### Task 9: Facebook 发布与适配器组装

**Files:**
- Create: `src/platforms/facebook/index.ts`
- Test: `src/platforms/facebook/index.test.ts`

**Interfaces:**
- Consumes: 全部前序产物
- Produces:
  - `FacebookAdapter implements PlatformAdapter`，构造参数
    `(transport: FacebookTransport, store: CredentialStore, opts: { appId: string; appSecret: string; redirectUri: string })`
  - `FACEBOOK_CAPABILITIES: PlatformCapabilities`
  - `FACEBOOK_TOKEN_POLICY: TokenPolicy`

- [ ] **Step 1: 写失败的测试**

创建 `src/platforms/facebook/index.test.ts`：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import type { PublishTask } from '../../types.js'
import { InMemoryCredentialStore } from '../../storage/credential.store.js'
import { FakeFacebookTransport } from './transport.js'
import { FacebookAdapter } from './index.js'

const OPTS = { appId: 'a', appSecret: 's', redirectUri: 'http://localhost/cb' }

async function bound() {
  const store = new InMemoryCredentialStore()
  await store.save({
    bizId: 'AOMI_SELF',
    platform: 'FACEBOOK',
    accessToken: 'page-token',
    accountId: 'u1',
    accountName: '澳觅',
    targetId: 'page-42',
    targetName: '澳觅官方主页',
  })
  const transport = new FakeFacebookTransport({
    'POST /page-42/feed': { id: 'page-42_post-9' },
    'POST /page-42/photos': { id: 'photo-1', post_id: 'page-42_post-9' },
    'GET /page-42_post-9': { id: 'page-42_post-9', permalink_url: 'https://fb.com/p/9' },
    'POST /page-42_post-9': { success: true },
  })
  return { adapter: new FacebookAdapter(transport, store, OPTS), transport }
}

const TASK: PublishTask = { bizId: 'AOMI_SELF', platform: 'FACEBOOK', text: '今日推荐' }

describe('FacebookAdapter 能力声明', () => {
  it('能回帖子评论——pages_manage_engagement 支持', async () => {
    expect((await bound()).adapter.capabilities.replyPostComment).toBe(true)
  })

  it('没有商家评价能力', async () => {
    expect((await bound()).adapter.capabilities.reviews).toBe(false)
  })

  it('正文外链可点', async () => {
    expect((await bound()).adapter.capabilities.clickableLink).toBe(true)
  })

  it('没有结构化优惠字段与原生多语言', async () => {
    const caps = (await bound()).adapter.capabilities
    expect(caps.offerFields).toBe(false)
    expect(caps.nativeLanguageCode).toBe(false)
  })

  it('Page token 不可刷新', async () => {
    expect((await bound()).adapter.tokenPolicy.refreshable).toBe(false)
  })
})

describe('FacebookAdapter.publish', () => {
  let ctx: Awaited<ReturnType<typeof bound>>

  beforeEach(async () => { ctx = await bound() })

  it('纯文字帖走 /feed，策略是 SYNC 且直接拿到 postId', async () => {
    const handle = await ctx.adapter.publish(TASK)
    expect(handle.strategy).toBe('SYNC')
    expect(handle.postId).toBe('page-42_post-9')
    expect(ctx.transport.calls.some((c) => c.path === '/page-42/feed')).toBe(true)
  })

  it('带图片时走 /photos', async () => {
    await ctx.adapter.publish({ ...TASK, mediaUrls: ['https://example.com/a.jpg'] })
    const call = ctx.transport.calls.find((c) => c.path === '/page-42/photos')
    expect(call?.params.url).toBe('https://example.com/a.jpg')
  })

  it('图片帖取 post_id 而不是 photo 的 id', async () => {
    const handle = await ctx.adapter.publish({ ...TASK, mediaUrls: ['https://example.com/a.jpg'] })
    expect(handle.postId).toBe('page-42_post-9')
  })

  it('发布前带上 Page token', async () => {
    await ctx.adapter.publish(TASK)
    expect(ctx.transport.calls[0].params.access_token).toBe('page-token')
  })

  it('校验不通过时直接抛错，不发任何请求', async () => {
    await expect(ctx.adapter.publish({ ...TASK, text: '  ', mediaUrls: [] })).rejects.toThrow(/正文与图片/)
    expect(ctx.transport.calls).toHaveLength(0)
  })

  it('未绑定的 bizId 抛出可读错误', async () => {
    await expect(ctx.adapter.publish({ ...TASK, bizId: 'NOBODY' })).rejects.toThrow(/未绑定/)
  })

  it('没有 awaitCompletion——Facebook 是同步策略', async () => {
    expect(ctx.adapter.awaitCompletion).toBeUndefined()
  })
})

describe('FacebookAdapter.verify', () => {
  it('平台侧存在时返回 true', async () => {
    const ctx = await bound()
    expect(await ctx.adapter.verify('AOMI_SELF', 'page-42_post-9')).toBe(true)
  })

  it('平台侧不存在时返回 false 而不是抛错', async () => {
    const store = new InMemoryCredentialStore()
    await store.save({
      bizId: 'AOMI_SELF', platform: 'FACEBOOK', accessToken: 't',
      accountId: 'u', accountName: 'n', targetId: 'page-42', targetName: 'p',
    })
    const transport = new FakeFacebookTransport({})
    const adapter = new FacebookAdapter(transport, store, OPTS)
    expect(await adapter.verify('AOMI_SELF', 'missing-post')).toBe(false)
  })
})

describe('FacebookAdapter.format', () => {
  it('复用纯函数 formatForFacebook 的行为', async () => {
    const ctx = await bound()
    const task = ctx.adapter.format(
      {
        storeId: 's1', languageCode: 'zh-CN', headline: '标题',
        text: '正文', imageUrls: [],
        callToAction: { label: '看看', url: 'https://x.example' },
      },
      'AOMI_SELF',
    )
    expect(task.text).toContain('标题')
    expect(task.text).toContain('https://x.example')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/platforms/facebook/index.test.ts`
Expected: FAIL，报无法解析 `./index.js`

- [ ] **Step 3: 实现**

创建 `src/platforms/facebook/index.ts`：

```typescript
import type {
  ContentDraft,
  PlatformAdapter,
  PlatformCapabilities,
  PublishHandle,
  PublishTask,
  PublishValidationIssue,
  TokenPolicy,
  Credential,
} from '../../types.js'
import type { CredentialStore } from '../../storage/credential.store.js'
import type { FacebookTransport } from './transport.js'
import { FacebookAuth } from './auth.js'
import { formatForFacebook, validateFacebookTask } from './format.js'

/**
 * Facebook Page 的能力。
 *
 * replyPostComment 为 true：POST /{comment-id}/comments，权限
 * pages_manage_engagement，需 Page token 持有者具备 MODERATE 权能。
 * postMetrics 为 false：旧的 impressions 体系已于 2026-06-15 下线，
 * 新的 Media Views 口径在 Plan 3 实现（设计文档 §4）。
 */
export const FACEBOOK_CAPABILITIES: PlatformCapabilities = {
  replyPostComment: true,
  reviews: false,
  mentions: false,
  offerFields: false,
  nativeLanguageCode: false,
  clickableLink: true,
  businessInfoWrite: false,
  postMetrics: false,
}

/** Page token 不过期，也无法刷新。 */
export const FACEBOOK_TOKEN_POLICY: TokenPolicy = { refreshable: false }

interface FeedResponse {
  id: string
}

interface PhotoResponse {
  id: string
  post_id?: string
}

export class FacebookAdapter implements PlatformAdapter {
  readonly platform = 'FACEBOOK' as const
  readonly capabilities = FACEBOOK_CAPABILITIES
  readonly tokenPolicy = FACEBOOK_TOKEN_POLICY

  private readonly auth: FacebookAuth

  constructor(
    private readonly transport: FacebookTransport,
    private readonly store: CredentialStore,
    opts: { appId: string; appSecret: string; redirectUri: string },
  ) {
    this.auth = new FacebookAuth(transport, store, opts)
  }

  // ── 授权：委托给 FacebookAuth ──

  getAuthUrl(bizId: string) { return this.auth.getAuthUrl(bizId) }
  handleCallback(code: string, state: string) { return this.auth.handleCallback(code, state) }
  getValidAccessToken(bizId: string) { return this.auth.getValidAccessToken(bizId) }
  getAccountInfo(bizId: string) { return this.auth.getAccountInfo(bizId) }

  // ── 生成层对接 ──

  format(draft: ContentDraft, bizId: string): PublishTask {
    return formatForFacebook(draft, bizId)
  }

  // ── 发布 ──

  validate(task: PublishTask): PublishValidationIssue[] {
    return validateFacebookTask(task)
  }

  private async credential(bizId: string): Promise<Credential> {
    const cred = await this.store.get(bizId, 'FACEBOOK')
    if (!cred) throw new Error(`${bizId} 尚未绑定 Facebook`)
    return cred
  }

  async publish(task: PublishTask): Promise<PublishHandle> {
    const issues = this.validate(task)
    if (issues.length > 0) {
      // 在发任何请求之前失败，不消耗 API 配额
      throw new Error(`校验不通过：${issues.map((i) => i.message).join('；')}`)
    }

    const cred = await this.credential(task.bizId)
    const media = task.mediaUrls ?? []

    if (media.length > 0) {
      // 单图帖走 /photos，返回体里的 post_id 才是帖子 id，photo 的 id 不是
      const res = await this.transport.post<PhotoResponse>(`/${cred.targetId}/photos`, {
        url: media[0],
        caption: task.text,
        access_token: cred.accessToken,
      })
      return { strategy: 'SYNC', postId: res.post_id ?? res.id }
    }

    const res = await this.transport.post<FeedResponse>(`/${cred.targetId}/feed`, {
      message: task.text,
      access_token: cred.accessToken,
    })
    return { strategy: 'SYNC', postId: res.id }
  }

  async verify(bizId: string, postId: string): Promise<boolean> {
    const cred = await this.credential(bizId)
    try {
      await this.transport.get<{ id: string }>(`/${postId}`, {
        fields: 'id,permalink_url',
        access_token: cred.accessToken,
      })
      return true
    } catch {
      // 回查失败一律视为「平台侧不存在」，不向上抛——
      // 调用方要的是布尔判断，不是错误分支
      return false
    }
  }

  async delete(bizId: string, postId: string): Promise<void> {
    const cred = await this.credential(bizId)
    await this.transport.post(`/${postId}`, {
      method: 'delete',
      access_token: cred.accessToken,
    })
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test src/platforms/facebook/index.test.ts`
Expected: PASS，15 个测试全绿

- [ ] **Step 5: 全量测试与类型检查**

Run: `npm run typecheck && npm test`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add src/platforms/facebook/index.ts src/platforms/facebook/index.test.ts
git commit -m "feat: Facebook 适配器组装

图片帖走 /photos 并取返回体的 post_id——photo 的 id 不是帖子 id。
verify 失败一律返回 false 不抛错，调用方要的是布尔判断。
capabilities.postMetrics 为 false：旧 impressions 体系已下线，
新的 Media Views 口径留到 Plan 3。"
```

---

### Task 10: 发布管线（校验、退避重试、落库）

**Files:**
- Create: `src/storage/post.store.ts`
- Create: `src/publishing/pipeline.ts`
- Test: `src/publishing/pipeline.test.ts`

**Interfaces:**
- Consumes: `PlatformAdapter`、`PublishTask`、`PublishResult`、`PublishError`、`Db`
- Produces:
  - `PostRecord = { id: string; bizId: string; dealId?: string; draftId?: string; platform: Platform; postId?: string; permalink?: string; trackToken?: string; status: 'PUBLISHED' | 'FAILED'; error?: string; createdAt: Date }`
  - `PostStore`，构造参数 `(db: Db)`，方法 `save(record: PostRecord): void`、`listRecent(limit: number): PostRecord[]`
  - `publishWithRetry(adapter: PlatformAdapter, task: PublishTask, opts?: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> }): Promise<PublishResult>`

- [ ] **Step 1: 写失败的测试**

创建 `src/publishing/pipeline.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { PlatformAdapter, PublishHandle, PublishTask, PublishResult } from '../types.js'
import { PublishError } from './errors.js'
import { publishWithRetry } from './pipeline.js'
import { openDb } from '../storage/db.js'
import { PostStore } from '../storage/post.store.js'

const TASK: PublishTask = { bizId: 'AOMI_SELF', platform: 'FACEBOOK', text: '内容' }

/** 只实现管线用得到的方法，其余抛错以确保管线没有偷偷调它们。 */
function makeAdapter(overrides: Partial<PlatformAdapter>): PlatformAdapter {
  const notUsed = () => { throw new Error('本测试不应调用该方法') }
  return {
    platform: 'FACEBOOK',
    capabilities: {
      replyPostComment: true, reviews: false, mentions: false, offerFields: false,
      nativeLanguageCode: false, clickableLink: true, businessInfoWrite: false, postMetrics: false,
    },
    tokenPolicy: { refreshable: false },
    format: notUsed as never,
    getAuthUrl: notUsed as never,
    handleCallback: notUsed as never,
    getValidAccessToken: notUsed as never,
    getAccountInfo: notUsed as never,
    validate: () => [],
    publish: notUsed as never,
    verify: async () => true,
    delete: notUsed as never,
    ...overrides,
  }
}

const noSleep = async () => {}

describe('publishWithRetry', () => {
  it('SYNC 策略一次成功', async () => {
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => ({ strategy: 'SYNC', postId: 'p1' }),
    })
    expect(await publishWithRetry(adapter, TASK, { sleep: noSleep })).toEqual({ postId: 'p1' })
  })

  it('POLLING 策略会调 awaitCompletion', async () => {
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => ({ strategy: 'POLLING', pendingToken: 'c1' }),
      awaitCompletion: async (_b, token): Promise<PublishResult> => ({ postId: `from-${token}` }),
    })
    expect(await publishWithRetry(adapter, TASK, { sleep: noSleep })).toEqual({ postId: 'from-c1' })
  })

  it('校验不通过时直接失败，不调 publish', async () => {
    let called = false
    const adapter = makeAdapter({
      validate: () => [{ field: 'text', message: '正文为空' }],
      publish: async () => { called = true; return { strategy: 'SYNC', postId: 'x' } },
    })
    await expect(publishWithRetry(adapter, TASK, { sleep: noSleep })).rejects.toThrow(/正文为空/)
    expect(called).toBe(false)
  })

  it('可重试错误会重试并最终成功', async () => {
    let attempts = 0
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => {
        attempts += 1
        if (attempts < 3) throw PublishError.fromHttpStatus(429, '限流')
        return { strategy: 'SYNC', postId: 'p1' }
      },
    })
    expect(await publishWithRetry(adapter, TASK, { sleep: noSleep })).toEqual({ postId: 'p1' })
    expect(attempts).toBe(3)
  })

  it('不可重试错误立即失败，只尝试一次', async () => {
    let attempts = 0
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => {
        attempts += 1
        throw PublishError.fromHttpStatus(400, '参数错')
      },
    })
    await expect(publishWithRetry(adapter, TASK, { sleep: noSleep })).rejects.toThrow(/参数错/)
    expect(attempts).toBe(1)
  })

  it('重试到上限后抛出最后一个错误', async () => {
    let attempts = 0
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => {
        attempts += 1
        throw PublishError.fromHttpStatus(500, '崩了')
      },
    })
    await expect(publishWithRetry(adapter, TASK, { maxAttempts: 3, sleep: noSleep })).rejects.toThrow(/崩了/)
    expect(attempts).toBe(3)
  })

  it('退避时长指数增长', async () => {
    const waited: number[] = []
    let attempts = 0
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => {
        attempts += 1
        if (attempts < 3) throw PublishError.fromHttpStatus(500, '崩了')
        return { strategy: 'SYNC', postId: 'p1' }
      },
    })
    await publishWithRetry(adapter, TASK, { sleep: async (ms) => { waited.push(ms) } })
    expect(waited).toEqual([1000, 2000])
  })

  it('publish 返回 SYNC 却没有 postId 时报错', async () => {
    const adapter = makeAdapter({ publish: async (): Promise<PublishHandle> => ({ strategy: 'SYNC' }) })
    await expect(publishWithRetry(adapter, TASK, { sleep: noSleep })).rejects.toThrow(/postId/)
  })

  it('POLLING 但适配器没实现 awaitCompletion 时报错', async () => {
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => ({ strategy: 'POLLING', pendingToken: 'c1' }),
    })
    await expect(publishWithRetry(adapter, TASK, { sleep: noSleep })).rejects.toThrow(/awaitCompletion/)
  })

  it('verify 返回 false 时抛错——平台侧没真的存在', async () => {
    const adapter = makeAdapter({
      publish: async (): Promise<PublishHandle> => ({ strategy: 'SYNC', postId: 'p1' }),
      verify: async () => false,
    })
    await expect(publishWithRetry(adapter, TASK, { sleep: noSleep })).rejects.toThrow(/回查/)
  })
})

describe('PostStore', () => {
  it('存进去能按时间倒序列出来', () => {
    const db = openDb(':memory:')
    const store = new PostStore(db)

    store.save({
      id: 'r1', bizId: 'AOMI_SELF', platform: 'FACEBOOK', postId: 'p1',
      status: 'PUBLISHED', createdAt: new Date(1000),
    })
    store.save({
      id: 'r2', bizId: 'AOMI_SELF', platform: 'FACEBOOK',
      status: 'FAILED', error: '限流', createdAt: new Date(2000),
    })

    const rows = store.listRecent(10)
    expect(rows.map((r) => r.id)).toEqual(['r2', 'r1'])
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].error).toBe('限流')
    expect(rows[1].postId).toBe('p1')
    db.close()
  })

  it('limit 生效', () => {
    const db = openDb(':memory:')
    const store = new PostStore(db)
    for (let i = 0; i < 5; i += 1) {
      store.save({
        id: `r${i}`, bizId: 'AOMI_SELF', platform: 'FACEBOOK',
        status: 'PUBLISHED', createdAt: new Date(i * 1000),
      })
    }
    expect(store.listRecent(2)).toHaveLength(2)
    db.close()
  })

  it('createdAt 往返后仍是 Date', () => {
    const db = openDb(':memory:')
    const store = new PostStore(db)
    const createdAt = new Date('2026-08-28T10:00:00.000Z')
    store.save({ id: 'r1', bizId: 'A', platform: 'FACEBOOK', status: 'PUBLISHED', createdAt })
    expect(store.listRecent(1)[0].createdAt.getTime()).toBe(createdAt.getTime())
    db.close()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/publishing/pipeline.test.ts`
Expected: FAIL，报无法解析 `./pipeline.js`

- [ ] **Step 3: 实现 PostStore**

创建 `src/storage/post.store.ts`：

```typescript
import type { Platform } from '../types.js'
import type { Db } from './db.js'

/**
 * 发布记录。
 *
 * dealId 与 trackToken 是归因链路的锚点：帖子级归属靠 dealId 本地 join，
 * 点击归因靠 trackToken 连到澳觅订单（设计文档 §9.3）。
 */
export interface PostRecord {
  id: string
  bizId: string
  dealId?: string
  draftId?: string
  platform: Platform
  postId?: string
  permalink?: string
  trackToken?: string
  status: 'PUBLISHED' | 'FAILED'
  error?: string
  createdAt: Date
}

interface Row {
  id: string
  biz_id: string
  deal_id: string | null
  draft_id: string | null
  platform: string
  post_id: string | null
  permalink: string | null
  track_token: string | null
  status: string
  error: string | null
  created_at: number
}

function toRecord(row: Row): PostRecord {
  const rec: PostRecord = {
    id: row.id,
    bizId: row.biz_id,
    platform: row.platform as Platform,
    status: row.status as PostRecord['status'],
    createdAt: new Date(row.created_at),
  }
  if (row.deal_id) rec.dealId = row.deal_id
  if (row.draft_id) rec.draftId = row.draft_id
  if (row.post_id) rec.postId = row.post_id
  if (row.permalink) rec.permalink = row.permalink
  if (row.track_token) rec.trackToken = row.track_token
  if (row.error) rec.error = row.error
  return rec
}

export class PostStore {
  constructor(private readonly db: Db) {}

  save(rec: PostRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO posts
           (id, biz_id, deal_id, draft_id, platform, post_id, permalink, track_token, status, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.bizId,
        rec.dealId ?? null,
        rec.draftId ?? null,
        rec.platform,
        rec.postId ?? null,
        rec.permalink ?? null,
        rec.trackToken ?? null,
        rec.status,
        rec.error ?? null,
        rec.createdAt.getTime(),
      )
  }

  listRecent(limit: number): PostRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Row[]
    return rows.map(toRecord)
  }
}
```

- [ ] **Step 4: 实现管线**

创建 `src/publishing/pipeline.ts`：

```typescript
import type { PlatformAdapter, PublishResult, PublishTask } from '../types.js'
import { PublishError } from './errors.js'

const DEFAULT_MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 1000

async function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface PublishOptions {
  maxAttempts?: number
  /** 注入点：测试传入空实现，避免真的等待 */
  sleep?: (ms: number) => Promise<void>
}

/**
 * 发布管线：校验 → 发布 → （必要时轮询）→ 回查确认。
 *
 * 只有 PublishError 且 retryable 为真才重试，指数退避。
 * 不可重试的错误重试多少次都一样，立即失败。
 */
export async function publishWithRetry(
  adapter: PlatformAdapter,
  task: PublishTask,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const sleep = opts.sleep ?? realSleep

  const issues = adapter.validate(task)
  if (issues.length > 0) {
    throw new Error(`校验不通过：${issues.map((i) => i.message).join('；')}`)
  }

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const handle = await adapter.publish(task)

      let result: PublishResult
      if (handle.strategy === 'POLLING') {
        if (!adapter.awaitCompletion) {
          throw new Error(`${adapter.platform} 返回 POLLING 策略但未实现 awaitCompletion`)
        }
        if (!handle.pendingToken) {
          throw new Error(`${adapter.platform} 返回 POLLING 策略但没有 pendingToken`)
        }
        result = await adapter.awaitCompletion(task.bizId, handle.pendingToken)
      } else {
        if (!handle.postId) {
          throw new Error(`${adapter.platform} 返回 SYNC 策略但没有 postId`)
        }
        result = { postId: handle.postId }
      }

      // 回查确认平台侧真的存在，而不是只信 API 的 200
      if (!(await adapter.verify(task.bizId, result.postId))) {
        throw new Error(`回查失败：${adapter.platform} 上找不到 ${result.postId}`)
      }

      return result
    } catch (err) {
      lastError = err

      const retryable = err instanceof PublishError && err.retryable
      if (!retryable || attempt === maxAttempts) break

      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1))
    }
  }

  throw lastError
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test src/publishing/pipeline.test.ts`
Expected: PASS，13 个测试全绿

- [ ] **Step 6: 提交**

```bash
git add src/storage/post.store.ts src/publishing/pipeline.ts src/publishing/pipeline.test.ts
git commit -m "feat: 发布管线与发布记录存储

只有 retryable 的 PublishError 才重试，指数退避 1s / 2s。
发布后必须回查确认平台侧真的存在，不只信 API 的 200。
sleep 做成注入点，测试不需要真的等待。
PostRecord 带 dealId 与 trackToken，是归因链路的锚点。"
```

---

### Task 11: Hono 服务与极简后台单页

**Files:**
- Create: `src/server.ts`
- Create: `src/web/index.html`
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes: 全部前序产物
- Produces: `createApp(deps): Hono` —— `deps` 为
  `{ adapter: PlatformAdapter; dataSource: DataSource; generator: ContentGenerator; postStore: PostStore }`

REST 面：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/stores` | 列出门店 |
| GET | `/api/stores/:id/deals` | 列出该门店在售团单 |
| GET | `/api/posts` | 最近 20 条发布记录 |
| GET | `/auth/meta/start?bizId=` | 返回授权 URL |
| GET | `/auth/meta/callback?code=&state=` | 处理回调 |
| POST | `/api/generate` | body `{ storeId, dealId? }` → `ContentDraft` |
| POST | `/api/publish` | body `{ bizId, draft }` → `{ postId }`，并落 `posts` 表 |

- [ ] **Step 1: 写失败的测试**

创建 `src/server.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import type { PlatformAdapter, PublishHandle } from './types.js'
import { createApp } from './server.js'
import { createMockDataSource, MOCK_STORES } from './content/source.js'
import { ContentGenerator, type TextCompletion } from './content/generator.js'
import { openDb } from './storage/db.js'
import { PostStore } from './storage/post.store.js'

const fakeCompletion: TextCompletion = {
  async complete() { return JSON.stringify({ headline: '标题', text: '正文' }) },
}

function makeAdapter(overrides: Partial<PlatformAdapter> = {}): PlatformAdapter {
  const notUsed = () => { throw new Error('本测试不应调用该方法') }
  return {
    platform: 'FACEBOOK',
    capabilities: {
      replyPostComment: true, reviews: false, mentions: false, offerFields: false,
      nativeLanguageCode: false, clickableLink: true, businessInfoWrite: false, postMetrics: false,
    },
    tokenPolicy: { refreshable: false },
    format: (draft, bizId) => ({ bizId, platform: 'FACEBOOK', text: draft.text }),
    getAuthUrl: async () => ({ url: 'https://facebook.com/dialog/oauth?x=1', state: 'st-1' }),
    handleCallback: async () => ({
      bizId: 'AOMI_SELF', platform: 'FACEBOOK', accessToken: 't',
      accountId: 'u', accountName: '澳觅', targetId: 'page-42', targetName: '澳觅官方主页',
    }),
    getValidAccessToken: notUsed as never,
    getAccountInfo: notUsed as never,
    validate: () => [],
    publish: async (): Promise<PublishHandle> => ({ strategy: 'SYNC', postId: 'p1' }),
    verify: async () => true,
    delete: notUsed as never,
    ...overrides,
  }
}

function makeApp(adapter = makeAdapter()) {
  const db = openDb(':memory:')
  const postStore = new PostStore(db)
  const app = createApp({
    adapter,
    dataSource: createMockDataSource(),
    generator: new ContentGenerator(fakeCompletion),
    postStore,
  })
  return { app, postStore, db }
}

describe('GET /api/stores', () => {
  it('返回全部门店', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/api/stores')
    expect(res.status).toBe(200)
    expect(await res.json()).toHaveLength(MOCK_STORES.length)
    db.close()
  })
})

describe('GET /api/stores/:id/deals', () => {
  it('返回该门店的团单', async () => {
    const { app, db } = makeApp()
    const res = await app.request(`/api/stores/${MOCK_STORES[0].id}/deals`)
    const deals = (await res.json()) as { storeId: string }[]
    expect(deals.every((d) => d.storeId === MOCK_STORES[0].id)).toBe(true)
    db.close()
  })
})

describe('POST /api/generate', () => {
  it('生成 ContentDraft', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId: MOCK_STORES[0].id, dealId: 'deal-001' }),
    })
    expect(res.status).toBe(200)
    const draft = (await res.json()) as { headline: string; languageCode: string }
    expect(draft.headline).toBe('标题')
    expect(draft.languageCode).toBe('zh-CN')
    db.close()
  })

  it('门店不存在时返回 404', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storeId: 'nope' }),
    })
    expect(res.status).toBe(404)
    db.close()
  })
})

describe('POST /api/publish', () => {
  const draft = {
    storeId: 'store-001', dealId: 'deal-001', languageCode: 'zh-CN',
    headline: '标题', text: '正文', imageUrls: [],
  }

  it('发布成功返回 postId', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bizId: 'AOMI_SELF', draft }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ postId: 'p1' })
    db.close()
  })

  it('发布成功后落一条 PUBLISHED 记录，且带上 dealId', async () => {
    const { app, postStore, db } = makeApp()
    await app.request('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bizId: 'AOMI_SELF', draft }),
    })
    const rows = postStore.listRecent(10)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('PUBLISHED')
    expect(rows[0].dealId).toBe('deal-001')
    db.close()
  })

  it('发布失败时返回 500 并落一条 FAILED 记录', async () => {
    const failing = makeAdapter({
      publish: async () => { throw new Error('主页被封了') },
    })
    const { app, postStore, db } = makeApp(failing)
    const res = await app.request('/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bizId: 'AOMI_SELF', draft }),
    })
    expect(res.status).toBe(500)
    const rows = postStore.listRecent(10)
    expect(rows[0].status).toBe('FAILED')
    expect(rows[0].error).toContain('主页被封了')
    db.close()
  })
})

describe('GET /api/posts', () => {
  it('返回发布记录', async () => {
    const { app, postStore, db } = makeApp()
    postStore.save({
      id: 'r1', bizId: 'AOMI_SELF', platform: 'FACEBOOK',
      postId: 'p1', status: 'PUBLISHED', createdAt: new Date(),
    })
    const res = await app.request('/api/posts')
    expect(await res.json()).toHaveLength(1)
    db.close()
  })
})

describe('GET /auth/meta/start', () => {
  it('返回授权 URL', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/auth/meta/start?bizId=AOMI_SELF')
    expect((await res.json()) as { url: string }).toMatchObject({
      url: expect.stringContaining('facebook.com'),
    })
    db.close()
  })

  it('缺 bizId 时返回 400', async () => {
    const { app, db } = makeApp()
    expect((await app.request('/auth/meta/start')).status).toBe(400)
    db.close()
  })
})

describe('GET /', () => {
  it('返回后台单页', async () => {
    const { app, db } = makeApp()
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    db.close()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test src/server.test.ts`
Expected: FAIL，报无法解析 `./server.js`

- [ ] **Step 3: 写后台单页**

创建 `src/web/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>澳觅公域账号中枢</title>
<style>
  body { font-family: system-ui, -apple-system, "PingFang SC", sans-serif;
         max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; }
  button { padding: .5rem 1rem; margin-right: .5rem; cursor: pointer; }
  select, textarea { width: 100%; padding: .5rem; margin: .5rem 0; box-sizing: border-box; }
  textarea { min-height: 8rem; font-family: inherit; }
  .row { margin: 1.5rem 0; padding-top: 1rem; border-top: 1px solid #ddd; }
  .msg { padding: .5rem; margin: .5rem 0; }
  .ok { background: #e8f5e9; }
  .err { background: #ffebee; }
  ul { padding-left: 1.2rem; }
</style>
</head>
<body>
<h1>澳觅公域账号中枢</h1>

<div class="row">
  <h2>1 · 绑定公域账号</h2>
  <button id="bind">绑定 Facebook 主页</button>
</div>

<div class="row">
  <h2>2 · 选门店与团单</h2>
  <select id="store"></select>
  <select id="deal"></select>
  <button id="gen">生成图文</button>
</div>

<div class="row">
  <h2>3 · 文案（可人工修改后再发）</h2>
  <textarea id="text" placeholder="点上面的「生成图文」"></textarea>
  <button id="pub" disabled>发布到 Facebook</button>
  <div id="msg"></div>
</div>

<div class="row">
  <h2>4 · 发布记录</h2>
  <ul id="posts"></ul>
</div>

<script>
const $ = (id) => document.getElementById(id)
let draft = null

function show(text, ok) {
  $('msg').className = 'msg ' + (ok ? 'ok' : 'err')
  $('msg').textContent = text
}

async function loadStores() {
  const stores = await (await fetch('/api/stores')).json()
  $('store').innerHTML = stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')
  await loadDeals()
}

async function loadDeals() {
  const deals = await (await fetch(`/api/stores/${$('store').value}/deals`)).json()
  $('deal').innerHTML =
    '<option value="">不带团单</option>' +
    deals.map((d) => `<option value="${d.id}">${d.title}（${(d.priceCents / 100).toFixed(2)} 澳门元）</option>`).join('')
}

async function loadPosts() {
  const posts = await (await fetch('/api/posts')).json()
  $('posts').innerHTML = posts
    .map((p) => `<li>${new Date(p.createdAt).toLocaleString('zh-CN')} · ${p.status} · ${p.postId || p.error || ''}</li>`)
    .join('')
}

$('store').onchange = loadDeals

$('bind').onclick = async () => {
  const res = await fetch('/auth/meta/start?bizId=AOMI_SELF')
  const body = await res.json()
  if (body.url) window.location.href = body.url
  else show(body.error || '绑定失败', false)
}

$('gen').onclick = async () => {
  show('生成中……', true)
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ storeId: $('store').value, dealId: $('deal').value || undefined }),
  })
  const body = await res.json()
  if (!res.ok) return show(body.error || '生成失败', false)
  draft = body
  $('text').value = draft.headline + '\n\n' + draft.text
  $('pub').disabled = false
  show('生成完成，确认无误后再发布', true)
}

$('pub').onclick = async () => {
  if (!draft) return
  // 以文本框里的内容为准，允许人工修改后再发
  const [headline, ...rest] = $('text').value.split('\n\n')
  const res = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bizId: 'AOMI_SELF',
      draft: { ...draft, headline, text: rest.join('\n\n') },
    }),
  })
  const body = await res.json()
  show(res.ok ? `已发布：${body.postId}` : body.error || '发布失败', res.ok)
  await loadPosts()
}

loadStores()
loadPosts()
</script>
</body>
</html>
```

- [ ] **Step 4: 实现服务**

创建 `src/server.ts`：

```typescript
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import Anthropic from '@anthropic-ai/sdk'
import type { ContentDraft, PlatformAdapter } from './types.js'
import { loadConfig } from './config.js'
import { openDb } from './storage/db.js'
import { SqliteCredentialStore } from './storage/credential.store.js'
import { PostStore } from './storage/post.store.js'
import { createMockDataSource, type DataSource } from './content/source.js'
import { ContentGenerator, ClaudeTextCompletion } from './content/generator.js'
import { HttpFacebookTransport } from './platforms/facebook/transport.js'
import { FacebookAdapter } from './platforms/facebook/index.js'
import { publishWithRetry } from './publishing/pipeline.js'
import { register } from './platforms/registry.js'

export interface AppDeps {
  adapter: PlatformAdapter
  dataSource: DataSource
  generator: ContentGenerator
  postStore: PostStore
}

// ESM 里没有 __dirname，必须从 import.meta.url 推导
const HERE = dirname(fileURLToPath(import.meta.url))

export function createApp(deps: AppDeps): Hono {
  const app = new Hono()

  app.get('/', (c) =>
    c.html(readFileSync(join(HERE, 'web', 'index.html'), 'utf8')),
  )

  app.get('/api/stores', async (c) => c.json(await deps.dataSource.listStores()))

  app.get('/api/stores/:id/deals', async (c) =>
    c.json(await deps.dataSource.listActiveDeals(c.req.param('id'))),
  )

  app.get('/api/posts', (c) => c.json(deps.postStore.listRecent(20)))

  app.get('/auth/meta/start', async (c) => {
    const bizId = c.req.query('bizId')
    if (!bizId) return c.json({ error: '缺少 bizId' }, 400)
    return c.json(await deps.adapter.getAuthUrl(bizId))
  })

  app.get('/auth/meta/callback', async (c) => {
    const code = c.req.query('code')
    const state = c.req.query('state')
    if (!code || !state) return c.json({ error: '缺少 code 或 state' }, 400)
    try {
      const cred = await deps.adapter.handleCallback(code, state)
      return c.html(`<p>已绑定：${cred.targetName}</p><a href="/">返回后台</a>`)
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
    }
  })

  app.post('/api/generate', async (c) => {
    const { storeId, dealId } = await c.req.json<{ storeId?: string; dealId?: string }>()
    if (!storeId) return c.json({ error: '缺少 storeId' }, 400)

    const store = await deps.dataSource.getStore(storeId)
    if (!store) return c.json({ error: `门店不存在：${storeId}` }, 404)

    const deal = dealId
      ? (await deps.dataSource.listActiveDeals(storeId)).find((d) => d.id === dealId)
      : undefined

    try {
      return c.json(await deps.generator.generate(store, deal))
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
    }
  })

  app.post('/api/publish', async (c) => {
    const { bizId, draft } = await c.req.json<{ bizId?: string; draft?: ContentDraft }>()
    if (!bizId || !draft) return c.json({ error: '缺少 bizId 或 draft' }, 400)

    const task = deps.adapter.format(draft, bizId)
    const base = {
      id: randomUUID(),
      bizId,
      dealId: draft.dealId,
      platform: deps.adapter.platform,
      createdAt: new Date(),
    }

    try {
      const result = await publishWithRetry(deps.adapter, task)
      deps.postStore.save({
        ...base,
        postId: result.postId,
        permalink: result.permalink,
        status: 'PUBLISHED',
      })
      return c.json(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // 失败也要落库，后台才看得到失败原因
      deps.postStore.save({ ...base, status: 'FAILED', error: message })
      return c.json({ error: message }, 500)
    }
  })

  return app
}

/** 进程入口。被 import 时不执行，只有直接运行本文件才启动。 */
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig()
  const db = openDb(config.databaseUrl)
  const credentialStore = new SqliteCredentialStore(db, config.credentialEncryptionKey)

  const adapter = new FacebookAdapter(
    new HttpFacebookTransport(config.metaGraphVersion),
    credentialStore,
    {
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
      redirectUri: config.metaRedirectUri,
    },
  )
  register(adapter)

  const app = createApp({
    adapter,
    dataSource: createMockDataSource(),
    generator: new ContentGenerator(new ClaudeTextCompletion(new Anthropic())),
    postStore: new PostStore(db),
  })

  serve({ fetch: app.fetch, port: config.port })
  console.log(`社媒中枢已启动：http://localhost:${config.port}`)
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm test src/server.test.ts`
Expected: PASS，11 个测试全绿

- [ ] **Step 6: 确认 HTML 会被复制到构建产物**

`tsc` 不会复制 `.html`。测试直接从 `src/` 读文件所以能过，但 `npm run build` 后 `dist/web/index.html` 不存在。在 `package.json` 里把 build 改成：

```json
"build": "tsc && node -e \"require('node:fs').cpSync('src/web','dist/web',{recursive:true})\""
```

- [ ] **Step 7: 全量测试与类型检查**

Run: `npm run typecheck && npm test`
Expected: 全部通过，约 100 个测试

- [ ] **Step 8: 手动验收——真的发一条帖子**

这一步需要真实凭证，不能自动化。

1. 在 `.env` 里填好 `META_APP_ID`、`META_APP_SECRET`，并生成密钥：
   `openssl rand -hex 32` 写入 `CREDENTIAL_ENCRYPTION_KEY`
2. 确认 Meta 应用处于开发模式，且你的账号在该应用上有 Administrator 角色
3. `npm run dev`，打开 `http://localhost:3000`
4. 点「绑定 Facebook 主页」，走完 OAuth
5. 选门店与团单，点「生成图文」，确认文案没有编造事实
6. 点「发布到 Facebook」
7. **打开你自己的 Facebook 主页，确认帖子真的在那儿**

若第 7 步看不到帖子：开发模式下的数据只对该应用有 Administrator / Developer /
Tester / Analytics User 角色的用户可见（设计文档 §4）。用有角色的账号查看。

- [ ] **Step 9: 提交**

```bash
git add src/server.ts src/web/index.html src/server.test.ts package.json
git commit -m "feat: Hono 服务与极简后台单页

端到端链路打通：选门店 → 生成 → 人工确认 → 发布 → 落库。
发布失败也落库，后台才看得到失败原因。
文案发布前经文本框，允许人工修改——生成的内容要发到公域，
不能不看就发。
ESM 里没有 __dirname，静态页路径从 import.meta.url 推导。"
```

---

## 自查记录

**Spec 覆盖**（对照设计文档，Plan 1 应覆盖的部分）：

| Spec 章节 | 覆盖它的 Task |
|---|---|
| §3 约束 1（生成层属本项目） | Task 5 |
| §3 约束 2（先 mock，留 DataSource） | Task 4 |
| §3 约束 4（SQLite，加密落盘） | Task 3 |
| §3.1（v1 简中，`zh-CN`） | Task 5（`languageCode` 硬编码 + 测试） |
| §3 约束 6（极简单页） | Task 11 |
| §4（Graph API v26.0） | Task 1 Step 2 |
| §4（开发模式可见性） | Task 8 注释 + Task 11 Step 8 验收说明 |
| §5（目录结构） | Task 3–11 逐个建立 |
| §5.1（生成层正交、format 纯函数） | Task 7 |
| §6.1（CompletionStrategy） | Task 2 + Task 10 |
| §6.2（validate） | Task 7 |
| §6.3（capabilities 八字段） | Task 2 + Task 9 |
| §6.4（tokenPolicy） | Task 2 + Task 9 |
| §6.5（ContentDraft） | Task 2 + Task 5 |
| §7（数据流） | Task 10 + Task 11 |
| §8（存储模型） | Task 3（credentials/drafts/posts 建表）+ Task 10（PostStore） |
| §9.3 第 1 层（帖子级归属） | Task 10（PostRecord 带 dealId）+ Task 11（发布时写入） |
| §12（错误分级与退避） | Task 2 测试 + Task 10 |
| §13（Transport 可注入、离线单测） | Task 6、8、9 |

**不在 Plan 1、明确留给后续**：§6.6 互动面契约、§9.3 第 2–3 层归因、§10 门店信息同步、§11 跨平台联动、§8 的 `interactions` / `metrics` / `stores` / `attribution` 表、Instagram 与 Google 适配器。这些进 Plan 2 与 Plan 3。

**类型一致性**：`ContentDraft`、`PublishTask`、`PublishHandle`、`PlatformCapabilities`、`TokenPolicy`、`Credential`、`PostRecord` 在 Task 2、3、10 定义一次，后续 Task 只 import，字段名全文一致。`format(draft, bizId)` 的两参数签名在 Task 2 契约、Task 7 实现、Task 9 适配器、Task 11 调用点四处一致。

**已知的两处需实现者留意**：
1. Task 5 的 `output_config` / `thinking` 字段名依赖 `@anthropic-ai/sdk` 的实际版本，若类型报错按 `node_modules` 里的定义调整，不要删参数。
2. Task 3 Step 9 删除 `src/auth/credential.store.ts` 前，先 `grep -rn "auth/credential.store" src/` 确认没有残留引用。
