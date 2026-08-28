# social-hub 设计文档

日期：2026-08-28
状态：已评审通过，待转实现计划

---

## 1. 定位

可插拔的公域账号中枢：一次授权，多平台发布、评论托管与数据回流。

核心资产是三个横切接口，不是任何单一平台的功能。Facebook 是**验证架构的第一个实例**，
不是项目本身。这个定位让「Facebook 能力弱」和「Google 配额未批」都不再构成项目的生死问题。

冷启动策略：第一个客户是澳觅自己，不是商家。先给自己的主页供稿两周拿真实数据，
再去谈授权——绕开「商家凭什么授权你」这个先有鸡还是先有蛋的死结。

## 2. 范围

### 做

- 三个平台适配器：Facebook Page、Instagram Business、Google Business Profile
- OAuth 授权、凭证加密存储、按平台分叉的 token 刷新
- 内容生成层：门店/团单 → 图文（繁中 + 英文两版）
- 发布链路：校验 → 平台裁剪 → 发布 → 回查确认
- 评论托管：拉取评论 → AI 起草 → **人工确认** → 发出
- 数据回流：账号级与帖子级指标
- 极简后台单页（无构建步骤）

### 不做（红线，要主动对外说明）

- 自动点赞 / 收藏 / 关注 / 养号 —— 平台政策红线，澳觅是持牌平台
- 模拟登录抓 cookie
- 全网舆情监测 —— Meta 只能读自己主页的评论，准确说法是「评论托管」

前两条是红线，第三条是能力边界。

### 本轮不做（留接口）

- Webhook 接收评论（先轮询）
- 接澳觅真实门店/团单 API（先 mock）
- 多于繁中 + 英文的语言

## 3. 已确认的约束

| # | 约束 | 影响 |
|---|---|---|
| 1 | 内容生成属于本项目范围，含提示词与模型调用 | 三横切面 + 一个正交的生成层 |
| 2 | 门店/团单先 mock，留可替换 `DataSource` | 以后接澳觅 API 只换实现 |
| 3 | 视频调澳觅服务；文案与图片本项目自己接模型 | `AOMI_AI_VIDEO_BASE_URL` 只管视频 |
| 4 | 存储用 SQLite，零运维 | token 加密落盘，重启不丢 |
| 5 | 简体中文 = 后台界面与代码注释；发出去的文案用繁中 + 英文 | 见 §3.1 |
| 6 | 后台要做，极简单页 | Hono 同时出 REST 与静态页 |
| 7 | 不等 Google 审批，适配器按接口写全接 mock | 配额批下来只换 Transport |
| 8 | Graph API 起步版本 v26.0 | 见 §4 |

### 3.1 语言决策的依据

发文语言定为繁中 + 英文，而非简体中文。理由：Facebook 与 Instagram 在内地不可用，
Google Maps 内地客基本不用——简中在这三个平台上没有对应读者群。
澳门本地与港台读繁中，国际客读英文，覆盖 PLAN.md 认定的那 27%（1094 万人次）入境客群。

简体中文用于后台界面与代码注释。

## 4. 已核验的外部事实

以下均于 2026-08-28 通过官方文档或 GitHub API 核实，替代 PLAN.md 中标注为「未核实」的条目。

### 必须据此调整的

**Graph API 当前版本是 v26.0**（2026-07-29 发布）。仓库原定的 v23.0 发布于 2025-05-29、
2027-10-08 到期，仍可用但落后三个版本。`META_GRAPH_VERSION` 改为 `v26.0`。

**Page Insights 指标已于 2026-06-15 大规模下线，所有 API 版本生效。**
`post_impressions`、`page_posts_impressions` 及其 organic/paid 拆分全部移除，
替换为 Media Views / Media Viewers 体系（`post_media_view`、`page_media_view`）。
`PostMetrics.impressions` 在 Meta 侧已取不到数——数据回流层按新口径实现，不是改字段名。

**Facebook Page 可以回复评论。** `POST /{comment-id}/comments`，权限 `pages_manage_engagement`，
需 Page token 持有者具备 `MODERATE` 权能；发送前应读 comment 的 `can_comment` 字段判断可回性。
仓库原 instagram/README.md 称 IG 是「唯一能自动回评论的平台」，此说法不成立——
且 `pages_manage_engagement` 本就在 facebook/README.md 的权限清单里，文档自相矛盾。

### 证实为真的

**开发模式可见性限制成立，且有官方文档依据**（原为实践报告）。Meta 原文：
"Any data generated while in development mode can only be seen by users who have a role on your app."
角色限于 Administrator / Developer / Tester / Analytics User。
演示前必须把评委加为 tester，否则他们刷不到帖子——这是必要条件，不是保险措施。

**GBP 配额：0 QPM = 未获批准，300 QPM = 已批准。** 官方明确要求提交
Application for Basic API Access，**不要走 quota increase 流程**。

**「Basic Access 已批但 Account Management API 配额仍为 0，卡死 `accounts.list`」是真实已知问题**，
Google 官方社区有对应主题帖。

**`localPosts` v4 未列入日落计划，仍可用。** `reportInsights` 已停用，
替代品是 Business Profile Performance API v1 的 `fetchMultiDailyMetricsTimeSeries`——
Google 侧数据回流走这个接口。

**Instagram 回复评论可用**：`POST /<IG_COMMENT_ID>/replies`，
权限名 `instagram_business_manage_comments` 正确。

### 补充差异

Google `topicType` 官方枚举含 `ALERT`，仓库 README 只列了 STANDARD / EVENT / OFFER。

### 仍未核实

澳门主体申请 GBP API 的通过率与周期——无任何公开数据点。本方案不依赖它。

## 5. 架构

```
src/
├── types.ts              核心契约
├── content/              内容生成层（与平台正交）
│   ├── source.ts           DataSource 接口 + MockDataSource
│   ├── generator.ts        Store + Deal → ContentDraft
│   └── prompts.ts          提示词
├── platforms/
│   ├── registry.ts         平台注册表
│   ├── facebook/           auth / publish / insight / format / transport
│   ├── instagram/          同上，publish 走容器模式
│   └── google-business/    同上，Transport 先接 mock
├── publishing/
│   ├── errors.ts           错误分级
│   └── pipeline.ts         validate → format → publish → verify，带退避重试
├── insights/
│   └── poller.ts           定时拉评论与指标
├── storage/
│   ├── db.ts               SQLite 连接与建表
│   ├── credential.store.ts token 加密落盘
│   └── post.store.ts       发布记录、评论、草稿回复
├── server.ts               Hono：REST + 静态页
└── web/index.html          极简后台，无构建
```

### 5.1 生成层为何与平台正交

`ContentGenerator` 吃 `Store + Deal`，产出中性素材包 `ContentDraft`；
各平台适配器用一个**纯函数** `format(draft) → PublishTask` 做裁剪。

- 提示词只有一套，模型只调一次，同时出繁中与英文
- 新增平台 = 三个接口 + 一个纯函数（无 IO，易测），README 的「接一个新平台 = 实现三个接口」基本保住
- Google 的 `offer.couponCode` / `languageCode` 等结构化字段有确定落点

放弃的备选：按平台分叉生成（`PlatformContent` 成为第四个接口）——
三个平台的文案差异主要是长度与字段裁剪，不是文风，分叉带来的提示词重复与模型调用翻倍
换不到对应收益。

## 6. 核心契约

在现有 `types.ts` 基础上的四处改动。

### 6.1 发布完成策略

现有 `publish(task): Promise<PublishResult>` 假设同步返回 postId。
该假设对 Facebook 纯文字帖成立，**对 Instagram 容器模式不成立**——
`createMediaContainer → 等待容器就绪 → publishMediaContainer` 中间必须轮询容器状态。

```ts
export type CompletionStrategy = 'SYNC' | 'POLLING'

export interface PublishHandle {
  strategy: CompletionStrategy
  /** SYNC 时直接给出 */
  postId?: string
  /** POLLING 时给出，如 IG 的容器 id */
  pendingToken?: string
}

export interface PlatformPublish {
  validate(task: PublishTask): PublishValidationIssue[]
  publish(task: PublishTask): Promise<PublishHandle>
  /** 仅 POLLING 策略实现；轮询至就绪后完成发布 */
  awaitCompletion?(bizId: string, pendingToken: string): Promise<PublishResult>
  verify(bizId: string, postId: string): Promise<boolean>
  delete(bizId: string, postId: string): Promise<void>
}
```

### 6.2 发布前校验

```ts
export interface PublishValidationIssue {
  field: string
  message: string
}
```

同步纯函数。文案超长、IG 缺图、Google 缺 `topicType` 等在发起请求前就报出，
不消耗 API 配额，后台单页可即时提示。

### 6.3 能力声明取代异常

```ts
export interface PlatformCapabilities {
  /** 能否回复评论。FB ✅ IG ✅ Google ❌ */
  replyComment: boolean
  /** 结构化优惠字段。仅 Google ✅ */
  offerFields: boolean
  /** 原生多语言字段。仅 Google ✅ */
  nativeLanguageCode: boolean
  /** 帖子级指标可用性 */
  postMetrics: boolean
}
```

声明式优于抛异常：后台可提前禁用按钮，而不是让用户点击后才失败。
`UnsupportedError` 保留为兜底，正常路径不应触达。

### 6.4 token 策略按平台声明

```ts
export interface TokenPolicy {
  refreshable: boolean
  /** 距过期多久开始刷新 */
  refreshBeforeMs?: number
}
```

Facebook Page token `refreshable: false`；Instagram 与 User token 提前 7 天刷新。
配套一个凭证健康检查定时任务：连续供稿两周期间，IG 的 60 天 token 不能等失效才发现。

### 6.5 中性素材包

生成层的产物，与任何平台无关。各平台的 `format()` 从中取用自己需要的部分。

```ts
export type Lang = 'zh-Hant' | 'en'

export interface ContentDraft {
  storeId: string
  dealId?: string
  /** 两种语言各一版；键为 languageCode，直接可喂给 Google 的 localPost */
  body: Record<Lang, { headline: string; text: string }>
  imageUrls: string[]
  videoUrl?: string
  /** 外链号召，Google 有原生字段，FB/IG 拼进正文 */
  callToAction?: { label: string; url: string }
  /** 结构化优惠，只有 Google 能原生承载 */
  offer?: { couponCode?: string; redeemUrl?: string; terms?: string }
}
```

各平台的裁剪规则：

| 平台 | 取用 |
|---|---|
| Facebook | 长文案，`callToAction` 拼进正文尾部，图片多张 |
| Instagram | 短文案 + 话题标签，必须有图或视频，`callToAction` 只能进正文 |
| Google | `headline` → summary，原生 `languageCode` 每语言各发一条，原生 `offer` 与 `callToAction` |

### 6.6 适配器完整形态

```ts
export interface PlatformAdapter extends PlatformAuth, PlatformPublish, PlatformInsight {
  readonly platform: Platform
  readonly capabilities: PlatformCapabilities
  readonly tokenPolicy: TokenPolicy
  /** 纯函数：中性素材包 → 该平台的发布任务 */
  format(draft: ContentDraft): PublishTask
}
```

## 7. 数据流

```
MockDataSource → Store + Deal
      ↓ ContentGenerator（文案繁中/英；图片；视频调澳觅服务）
   ContentDraft
      ↓ adapter.format(draft)          纯函数，按平台裁剪
   PublishTask
      ↓ adapter.validate(task)         有问题直接返回，不发请求
      ↓ adapter.publish(task)
        ├ SYNC    → postId
        └ POLLING → pendingToken → awaitCompletion() → postId
      ↓ adapter.verify(bizId, postId)  回查确认平台侧真的存在
   PostRecord 落 SQLite
      ↓ poller 定时 listComments + getPostMetrics
   评论 → AI 起草回复 → 【人工确认】→ adapter.replyComment()
```

人工确认是产品承诺，不是实现细节：草稿写入库并标记 `pending`，
必须经后台显式操作才调用 `replyComment`。

## 8. 存储模型

SQLite（better-sqlite3）。选它而非 Postgres 是为零运维；
Node 22 内置的 `node:sqlite` 仍为 experimental，不采用。

- `credentials` —— 凭证，`accessToken` / `refreshToken` 用 `CREDENTIAL_ENCRYPTION_KEY` 加密后存
- `drafts` —— 生成的素材包
- `posts` —— 发布记录：平台、postId、permalink、状态、发布时间
- `comments` —— 拉回的评论及其回复状态
- `reply_drafts` —— AI 起草的回复，状态 `pending` / `approved` / `sent`

`CredentialStore` 接口保持不变，仅替换实现——现有的 `InMemoryCredentialStore` 保留供测试使用。

## 9. 错误处理与重试

`PublishError.retryable` 维持现有分级：429 与 5xx 可重试，其余不可。

`publishing/pipeline.ts` 实现指数退避，最多 3 次。不可重试错误立即失败并落库，
便于后台展示失败原因。

## 10. 测试策略

每个平台的 HTTP 调用封装在 `Transport` 接口后，测试注入假 Transport，
**三个适配器全部可离线单测，不需要真实 token**。
Google 适配器就用这个机制接 mock，配额批下来后只换 Transport 实现。

按 TDD 实现的关键路径：

- `format()` 纯函数——三个平台各自的裁剪规则
- `validate()` 规则——各平台的长度与必填约束
- 错误分级——429 / 500 / 400 的 retryable 判定
- IG 容器轮询状态机——就绪、未就绪、超时、失败四种走向
- token 刷新分叉——Page token 不刷新、IG token 到期前刷新

## 11. 从 AiToEarn 的借鉴与取舍

参照 [AiToEarn](https://github.com/yikart/AiToEarn)（MIT，25.4k stars）。
抄的是分层方式与 API 调用序列，不是代码。

### 借鉴

- 发布分段（`validate` / `normalize` / `publish` / `finalize` / `verify`）——本项目简化为四段
- `CompletionStrategy` 枚举——直接暴露了本项目原契约对 IG 容器模式的错误假设
- `PlatformCapabilities` 声明式能力描述
- 每平台的 token 刷新策略与凭证健康检查定时任务
- 错误的 `retryable` 标记

### 刻意不抄

按「最小可行、不做投机性抽象」原则，以下属于 AiToEarn 的规模需要，非本项目需要：

- `EngagementProvider` 中的 like / follow / repost / bookmark —— **本项目划死的红线**
- `BrowseProvider`（搜索他人内容）—— 本项目定义的是评论托管，不是舆情监测
- `PublishOptionSourceProvider`（动态拉取平台可选项）—— 三个平台用不上
- MongoDB + Redis + BullMQ + NestJS 模块体系 —— 单页演示扛不起也不需要
- `PlatformIntegration` 的 12 个可选 provider —— 本项目只需 4 个

### 一处独立佐证

AiToEarn 有 `google-business` 目录，但其中只有 auth provider，没有 publish provider。
一个 13 平台、25k star 的项目在 Google Business 上也只做到授权就停了——
这佐证了配额审批是这条路上对所有人生效的阻塞，不是申请方式的问题。

## 12. 已知风险

| 风险 | 应对 |
|---|---|
| GBP 配额未批，Google 侧无法真实发布 | 适配器按接口写全接 mock，Transport 可替换；主线不依赖 |
| 开发模式下帖子仅对有角色者可见 | 演示前把评委加为 tester；台上主动说明 |
| IG token 60 天过期，供稿期中断 | 凭证健康检查定时任务，提前 7 天刷新 |
| Meta 指标口径 2026-06 已变更 | 数据回流层按 Media Views 体系实现，不用已下线的 impressions |
| 商家可能没有痛点（PLAN.md 验证清单未跑） | 该清单仍待执行；结论若为「商家更新得挺勤」则需换题 |

## 13. 待办

PLAN.md 的开工前验证清单尚未执行，其中四条需要本项目之外的信息：

1. 澳觅自己的 FB / IG 主页现状与最后更新时间
2. 抽 20 家签约商家看有无 Page 及更新频率
3. GCP Console 查 Business Profile API 实际配额（0 还是 300）
4. 内部是否已有人在做社媒相关项目

第 3 条与本设计的取舍无关（已按未批准规划）；第 1、2、4 条影响的是项目是否该继续，
不影响本设计的技术形状。
