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
- 内容生成层：门店/团单 → 图文（v1 单语言简体中文）
- 发布链路：校验 → 平台裁剪 → 发布 → 回查确认
- 统一收件箱：FB 评论 + IG 评论 + IG @提及 + Google 评价 → AI 起草 → **人工确认** → 发出
- 门店结构化信息同步：澳觅数据 → Google Business Profile
- 数据回流：账号级与帖子级指标、Google 到店转化指标
- 极简后台单页（无构建步骤）

### 不做（红线，要主动对外说明）

- 自动点赞 / 收藏 / 关注 / 养号 —— 平台政策红线，澳觅是持牌平台
- 模拟登录抓 cookie
- 全网舆情监测 —— Meta 只能读自己主页的评论，准确说法是「评论托管」

前两条是红线，第三条是能力边界。

### 本轮不做（留接口）

- Webhook 接收评论与提及（先轮询）
- 接澳觅真实门店/团单 API（先 mock）
- 多语言（v1 只出简体中文，见 §3.1）
- 门店健康度预警（见 §11.2，数据模型预留）
- IG hashtag 选题参考（见附录 A）

## 3. 已确认的约束

| # | 约束 | 影响 |
|---|---|---|
| 1 | 内容生成属于本项目范围，含提示词与模型调用 | 三横切面 + 一个正交的生成层 |
| 2 | 门店/团单先 mock，留可替换 `DataSource` | 以后接澳觅 API 只换实现 |
| 3 | 视频调澳觅服务；文案与图片本项目自己接模型 | `AOMI_AI_VIDEO_BASE_URL` 只管视频 |
| 4 | 存储用 SQLite，零运维 | token 加密落盘，重启不丢 |
| 5 | 简体中文 = 后台界面、代码注释、v1 发文语言 | 见 §3.1 |
| 6 | 后台要做，极简单页 | Hono 同时出 REST 与静态页 |
| 7 | 不等 Google 审批，适配器按接口写全接 mock | 配额批下来只换 Transport |
| 8 | Graph API 起步版本 v26.0 | 见 §4 |

### 3.1 语言决策

**v1 只出简体中文**，多语言留到后续版本。这是明确的产品决定。

需要记录的取舍：设计评审时曾建议改为繁中 + 英文，理由是 Facebook 与 Instagram
在内地不可用、Google Maps 内地客基本不用，简中在这三个平台上缺少对应读者群；
而 PLAN.md 认定的目标客群是那 27%（1094 万人次）港台与国际入境客，他们读繁中与英文。
该建议未被采纳，v1 按简中实现。

因此产生的两点影响，实现时不要忽略：

1. 演示脚本第 3 步「有多语言就同时出两版」在 v1 不成立，只出一版
2. Google `localPost` 的 `languageCode` 是必填字段，v1 传 `zh-CN`

后续要加语言时的扩展路径见 §6.5。

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

**Instagram feed 正文的链接不可点。** 这是产品设计而非 API 限制。
2026-03 起 Meta 在测试正文可点链接，但仅限订阅 Meta Verified 的专业创作者账号、
每月上限 10 条，不能作为方案基础。IG 的可用外链出口只有 bio 链接（2026 年上限 5 条）
与 Stories 的 link sticker。归因影响见 §9.3。

**Business Profile Performance API v1 提供到店转化级指标**：
`BUSINESS_FOOD_ORDERS`、`BUSINESS_DIRECTION_REQUESTS`、`BUSINESS_BOOKINGS`、
`CALL_CLICKS`、`WEBSITE_CLICKS` 等，按 location 日度聚合。详见 §9.3。

**Instagram 可读取 @提及与被标记的媒体，并可回复提及。**

```
GET  /{ig-user-id}/tags             别人把本账号标记在照片里的媒体
GET  /{ig-user-id}/mentioned_media  @提及本账号的媒体
POST /{ig-user-id}/mentions         回复对方 caption 或评论中对本账号的 @
```

可用 webhook 订阅 mentions 事件。限制：Stories 中的提及不支持；
被标记的照片不支持评论。

这是官方允许的、读取「他人内容」的通道，但范围严格限于 @ 了本账号或标记了本账号的内容，
不是全网抓取——**属于能力边界之内，不触犯本项目的红线**。详见 §11.1。

**Google Q&A API 已停用。** 官方 changelog 原文：
"On November 3, 2025, we will be discontinuing the My Business Q&A API as we are in the
process of updating the Q&A functionality and user experience."
读写均不可用，官方文档**未点名任何继任者**。

业界报道称替代品为 Gemini 驱动的 Ask Maps，从 Profile 的服务、属性、营业时间、类目、
照片，以及评价与官网实时生成答案。**该说法来自营销博客而非 Google 开发者文档，
未经官方确认**，但若成立，则显著提高 §10 门店信息同步的价值——
结构化数据不再只是给人看，而是 AI 答案的输入。

**Instagram Hashtag Search 可用，但额度极紧**：
`/ig_hashtag_search`、`/{ig-hashtag-id}/top_media`、`/{ig-hashtag-id}/recent_media`，
限每 7 天滚动窗口 30 个唯一 hashtag、每次最多 50 条、返回不含用户信息。
该额度决定它只能做选题参考，做不了监测。见附录 A。

**Google Business Profile Reviews API 仍活跃**（v4，官方文档 2026-04-07 更新）：
`accounts.locations.reviews.list` 读评价、`accounts.locations.reviews.updateReply` 回复评价。

**Business Information API v1 可写入门店结构化信息**：
`PATCH /v1/locations/{id}`（`updateMask` 指定字段，`validateOnly` 可先验证不写入）、
`locations.updateAttributes`。Scope 为 `https://www.googleapis.com/auth/business.manage`。

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
│   ├── poller.ts           定时拉互动与指标
│   └── compare.ts          跨平台效果对照（§11.3）
├── businessinfo/
│   └── sync.ts             澳觅门店数据 → Google Profile（§10）
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

- 提示词只有一套，模型只调一次；加语言时也只是多调几次，不动平台层
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
```

声明式优于抛异常：后台可提前禁用按钮，而不是让用户点击后才失败。
`UnsupportedError` 保留为兜底，正常路径不应触达。

**`replyComment` 拆成 `replyPostComment` 与 `reviews` 是一处修正。**
原设计把「回复帖子评论」与「回复评价」混为一个字段，据此判定 Google 不能回复。
实际上 Google 不能回帖子评论（localPost 无评论），但能读写商家评价——
而评价的商业权重高于帖子评论。合并成一个布尔值会直接丢掉 Google 侧最有价值的互动能力。

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
export interface ContentDraft {
  storeId: string
  dealId?: string
  /** v1 恒为 'zh-CN'。Google localPost 的必填字段，一路透传 */
  languageCode: string
  headline: string
  /** 生成时按最长平台（Facebook）产出，短平台在 format() 里截断 */
  text: string
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
| Facebook | 全量 `text`，`callToAction` 拼进正文尾部，图片多张 |
| Instagram | 截断 `text` + 话题标签，必须有图或视频，`callToAction` 只能进正文 |
| Google | `headline` → summary，`languageCode` 原生透传，原生 `offer` 与 `callToAction` |

**加语言时的扩展路径**：`ContentDraft` 保持单语言不变，改为一次生成返回
`ContentDraft[]`（每语言一份），发布层对每份独立走一遍现有链路。
Google 侧本就是每语言一条 `localPost`，天然对齐；FB/IG 需要产品上先决定
是发多条还是只发一条主语言。v1 不预留这个分支。

### 6.6 互动面契约

原 `PlatformInsight` 只有帖子评论一种互动对象。实际有三种，且分布在不同平台上：

```ts
export interface Interaction {
  id: string
  kind: 'COMMENT' | 'REVIEW' | 'MENTION'
  authorName: string
  text: string
  createdAt: Date
  /** REVIEW 独有 */
  rating?: number
  /** MENTION 独有：对方媒体的链接 */
  sourceUrl?: string
  replied: boolean
}

export interface PlatformInteraction {
  /** 按能力声明决定实现哪几种 kind */
  listInteractions(bizId: string, kind: Interaction['kind'], postId?: string): Promise<Interaction[]>
  reply(bizId: string, interaction: Interaction, text: string): Promise<void>
}
```

三种互动对象的平台分布：

| kind | Facebook | Instagram | Google | 端点 |
|---|---|---|---|---|
| COMMENT | ✅ | ✅ | ❌ | `POST /{comment-id}/comments`、`POST /<IG_COMMENT_ID>/replies` |
| REVIEW | ❌ | ❌ | ✅ | `accounts.locations.reviews.list` / `.updateReply` |
| MENTION | ❌ | ✅ | ❌ | `GET /{ig-user-id}/mentioned_media`、`/tags`；`POST /{ig-user-id}/mentions` |

统一成一个 `Interaction` 而非三套接口，是因为**后台的处理动作完全相同**：
读出来、AI 起草、人工确认、发出。差异只在取数端点与是否有 `rating`。

被标记的媒体（`/tags`）以 `MENTION` 形式返回，但 `reply` 对它不可用——
Instagram 不支持评论「你被标记的照片」。`replied` 恒为 `false`，后台只做展示与 UGC 采集。

### 6.7 适配器完整形态

```ts
export interface PlatformAdapter extends PlatformAuth, PlatformPublish, PlatformInsight, PlatformInteraction {
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
      ↓ ContentGenerator（文案简中；图片；视频调澳觅服务）
   ContentDraft
      ↓ adapter.format(draft)          纯函数，按平台裁剪
   PublishTask
      ↓ adapter.validate(task)         有问题直接返回，不发请求
      ↓ adapter.publish(task)
        ├ SYNC    → postId
        └ POLLING → pendingToken → awaitCompletion() → postId
      ↓ adapter.verify(bizId, postId)  回查确认平台侧真的存在
   PostRecord 落 SQLite
      ↓ poller 定时 listInteractions(COMMENT | REVIEW | MENTION) + getPostMetrics
   互动 → AI 起草回复 → 【人工确认】→ adapter.reply()
```

人工确认是产品承诺，不是实现细节：草稿写入库并标记 `pending`，
必须经后台显式操作才调用 `reply()`。

`PlatformInsight` 原有的 `replyComment` 移入 §6.6 的 `PlatformInteraction`，
并泛化为可处理三种互动对象。

## 8. 存储模型

SQLite（better-sqlite3）。选它而非 Postgres 是为零运维；
Node 22 内置的 `node:sqlite` 仍为 experimental，不采用。

- `stores` —— 澳觅门店 ↔ 平台发布目标的显式映射：`(aomiStoreId, platform, targetId, targetName)`
- `credentials` —— 凭证，`accessToken` / `refreshToken` 用 `CREDENTIAL_ENCRYPTION_KEY` 加密后存
- `drafts` —— 生成的素材包
- `posts` —— 发布记录：`bizId`、`dealId`、平台、postId、permalink、`trackToken`、状态、发布时间
- `interactions` —— 统一的互动记录：`kind`（COMMENT/REVIEW/MENTION）、平台、门店、
  作者、正文、`rating`、`sourceUrl`、回复状态。**按门店与日期建索引**，为 §11.2 预留
- `reply_drafts` —— AI 起草的回复，状态 `pending` / `approved` / `sent`
- `metrics` —— 按门店与日期存的指标快照，含 Google 的到店转化指标。同样按门店与日期建索引
- `attribution` —— `trackToken` → 点击时间、澳觅订单 ID（订单 ID 需澳觅侧回写，见 §9.4）

`stores` 表是新增的。原设计靠 `Credential.bizId` 隐含表达这层映射，
但 `bizId` 语义模糊——它既可能是 `'AOMI_SELF'`，也可能是某个门店 ID。
归因链路要按门店聚合，这层映射必须显式化。

`CredentialStore` 接口保持不变，仅替换实现——现有的 `InMemoryCredentialStore` 保留供测试使用。

## 9. 与澳觅的数据关联

打通分两个方向，难度差一个数量级：出站是工程问题，回流关联被平台能力卡住。

### 9.1 出站：关联键已在契约里

`Credential` 的 `bizId` ↔ `targetId` 就是「澳觅门店 ↔ 平台发布目标」的映射——
一条授权记录同时记住了这是澳觅的哪家店、对应平台上的哪个 pageId / igUserId / locationId。
不需要新增机制，只需 `DataSource` 从澳觅拉 `Store` 与 `Deal`。

### 9.2 `DataSource` 有两个用途

原设计只写了「供内容生成取数」，漏了第二个：**评论托管起草回复时要读澳觅的实时数据**。
评论问「几点打烊」「还有位吗」，AI 起草需要门店营业时间与团单库存。
`DataSource` 接口要同时满足这两类读取。

### 9.3 回流：四个层次，可靠性递减

**第 1 层 · 帖子级归属（100% 可靠，零平台依赖）**

`posts` 表存 `(bizId, dealId, platform, postId)`，平台按 `postId` 返回指标与评论，本地 join。
能回答「哪家店、哪个团单的帖子曝光多少」，回答不了「带来多少生意」。

**第 2 层 · 点击归因（唯一能连到成交的链路）**

落地链接挂唯一 token：`https://<澳觅域名>/deal/{dealId}?s={trackToken}`。
落地页把 token 写进 session，下单时带上，澳觅订单表多一个来源字段。

三个平台的外链能力差异是硬约束：

| 平台 | 外链可点 | 说明 |
|---|---|---|
| Google | ✅ | `callToAction` 原生字段 |
| Facebook | ✅ | 帖子可带链接 |
| Instagram | ❌ | feed 正文链接不可点 |

Instagram 这条是**产品设计而非 API 限制**。2026-03 起 Meta 在测试正文可点链接，
但仅限订阅 Meta Verified 的专业创作者账号且每月上限 10 条，不能作为方案基础。
IG 的可用出口只有 bio 链接（2026 年上限 5 条）与 Stories 的 link sticker。

**结论：Instagram 只能做到帖子级曝光与互动，做不到点击归因。**
这属于「能力边界要主动说清楚」的同类，演示时应主动说明。

**第 3 层 · Google 原生转化指标（最强的一层）**

Business Profile Performance API v1 的 `DailyMetric` 枚举：

```
BUSINESS_FOOD_ORDERS          从 Business Profile 产生的餐饮订单数
BUSINESS_FOOD_MENU_CLICKS     菜单点击（按用户按天去重）
BUSINESS_DIRECTION_REQUESTS   导航请求，到店意图
BUSINESS_BOOKINGS             预订数（Reserve with Google）
BUSINESS_CONVERSATIONS        消息会话数
CALL_CLICKS                   拨号按钮点击
WEBSITE_CLICKS                网站点击
BUSINESS_IMPRESSIONS_DESKTOP_MAPS / _DESKTOP_SEARCH
BUSINESS_IMPRESSIONS_MOBILE_MAPS / _MOBILE_SEARCH
```

这些指标是 **per-location** 的，而 location 与澳觅门店本就一一对应——
Google 侧不需要自建归因，它原生给出「这家店从 Google 带来多少订单、多少导航请求」。
`BUSINESS_FOOD_ORDERS` 对澳觅的业务形态直接对口。

这改变了 Google 在方案中的位置：它不只是「第二个接进来的平台」，
而是**唯一能自己给出到店转化数据的平台**。等配额的优先级因此高于原判断。

限制：location 级**日度聚合**，非 post 级。只能做「发帖前后对比」的准实验，
不能精确归因到单条帖子。

**第 4 层 · Meta Conversions API（v1 明确不做）**

把澳觅下单事件回传 Meta。不做的两个理由：CAPI 是为广告投放优化设计的，
organic 帖子的归因很弱；且需上传哈希后的手机号 / 邮箱等 PII，
澳觅是持牌平台，这是合规决策而非技术决策，不由本设计代为决定。

### 9.4 需要澳觅侧配合的三件事

第 2 层依赖以下三项，缺一则断：

1. 落地页能接住 `?s={token}` 并写入 session
2. **订单表增加来源字段**——动的是交易主链路，大概率需跨团队排期
3. 门店 / 团单只读 API

若第 2 条排不进去，第 2 层只能停在点击数、连不到成交，
届时 Google 的第 3 层就是唯一的转化证据。

## 10. 门店结构化信息同步

只有 Google 支持（`capabilities.businessInfoWrite`）。

```
PATCH https://mybusinessbusinessinformation.googleapis.com/v1/locations/{locationId}
  ?updateMask=regularHours,phoneNumbers,websiteUri&validateOnly=false
POST  .../v1/locations/{locationId}:updateAttributes
```

Scope `https://www.googleapis.com/auth/business.manage`，与发帖同一套授权。
`validateOnly=true` 可先跑一遍校验不写入——**同步前必须先用它做 dry run**，
写错门店信息的后果比发错帖子严重得多。

### 10.1 为什么它可能该排在发帖之前

澳觅手中有准确的营业时间、地址、电话、菜单价格；Google Business Profile 上这些信息普遍过时。

从冷启动角度看，它比发帖更容易换到授权：「我帮你发帖」需要商家判断内容质量，标准主观；
「你 Google 上的营业时间是错的，我帮你同步」商家掏出手机就能自己验证对错。
这直接作用于 README 提出的「商家凭什么把主页授权给你」这个死结。

从转化链条看，它与 §9.3 第 3 层连成一条：信息准确 → `BUSINESS_DIRECTION_REQUESTS`
上升 → 到店。转化证据是 Google 原生提供的，不需要自建归因。

若 Ask Maps 的报道成立（见 §4），价值再抬一档：结构化数据成为 AI 生成答案的输入，
营业时间填错等于让 Gemini 对每个提问者答错。

### 10.2 同步是单向的

澳觅 → Google，不反向。澳觅是权威数据源，Google Profile 是投影。
不做双向合并，避免冲突消解逻辑。

同步范围 v1 限于：`regularHours`、`specialHours`、`phoneNumbers`、`websiteUri`。
类目与地址不动——改动它们可能触发 Google 的重新验证流程。

## 11. 跨平台联动

### 11.1 统一收件箱（v1）

FB 评论 + IG 评论 + IG @提及与被标记 + Google 评价，汇入一个队列，一套处理动作。
契约见 §6.6。

关于 IG 提及与红线的关系：README 划的第三条是「不做全网舆情监测」。
`/mentioned_media` 与 `/tags` 读的是**@ 了本账号或标记了本账号的内容**，
不是按关键词全网抓取——是平台官方为账号主提供的通道，属于能力边界之内。
但对外表述仍应说「他人提及本账号的内容」，不说「舆情监测」。

被标记的媒体另有一层价值：客人拍摄菜品并标记门店，是餐饮场景下最可信的素材来源。
v1 只做展示与记录，不做转发——转发涉及他人内容授权，需要产品与法务先定规则。

### 11.2 门店健康度预警（v2，数据模型预留）

Google 评价星级下滑 + FB/IG 评论情绪转负 + 曝光下降，三个来源独立的信号叠加，
指向同一家门店出了问题，通知运营。

这条值得单独记录，因为**它可能改变项目的定位**：不是「社媒发布工具」，
而是**门店健康度监测**——社媒只是它最便宜的数据源。对一个签约商家数以百计的平台，
这个定位的量级远大于「帮商家发帖」，且只有做了多平台才做得出来。

v1 不实现，但 `interactions` 与 `metrics` 表按门店与日期建索引，
使后续做时间序列比较不需要迁移数据。

### 11.3 跨平台内容效果对照（v1，零 API 成本）

同一个 `ContentDraft` 发往三个平台，指标回来按 `draftId` join，
即可回答「同样的团单，什么内容形态在哪个平台有效」。

这是底座定位的天然产物：单平台工具做不到，做了三个平台就白拿这个能力，
不需要任何额外的 API 调用。

## 12. 错误处理与重试

`PublishError.retryable` 维持现有分级：429 与 5xx 可重试，其余不可。

`publishing/pipeline.ts` 实现指数退避，最多 3 次。不可重试错误立即失败并落库，
便于后台展示失败原因。

## 13. 测试策略

每个平台的 HTTP 调用封装在 `Transport` 接口后，测试注入假 Transport，
**三个适配器全部可离线单测，不需要真实 token**。
Google 适配器就用这个机制接 mock，配额批下来后只换 Transport 实现。

按 TDD 实现的关键路径：

- `format()` 纯函数——三个平台各自的裁剪规则
- `validate()` 规则——各平台的长度与必填约束
- 错误分级——429 / 500 / 400 的 retryable 判定
- IG 容器轮询状态机——就绪、未就绪、超时、失败四种走向
- token 刷新分叉——Page token 不刷新、IG token 到期前刷新

## 14. 从 AiToEarn 的借鉴与取舍

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

## 15. 已知风险

| 风险 | 应对 |
|---|---|
| GBP 配额未批，Google 侧无法真实发布 | 适配器按接口写全接 mock，Transport 可替换；主线不依赖 |
| 开发模式下帖子仅对有角色者可见 | 演示前把评委加为 tester；台上主动说明 |
| IG token 60 天过期，供稿期中断 | 凭证健康检查定时任务，提前 7 天刷新 |
| Meta 指标口径 2026-06 已变更 | 数据回流层按 Media Views 体系实现，不用已下线的 impressions |
| 商家可能没有痛点（PLAN.md 验证清单未跑） | 该清单仍待执行；结论若为「商家更新得挺勤」则需换题 |
| Instagram 无法做点击归因（feed 正文链接不可点） | 接受为能力边界，演示时主动说明；IG 只报曝光与互动 |
| 澳觅订单表来源字段排不进期 | 第 2 层归因停在点击数；Google 的第 3 层成为唯一转化证据 |
| 门店信息同步写错，影响真实经营 | `validateOnly=true` 强制 dry run；v1 不动类目与地址（见 §10.2） |
| IG 提及能力被误解为舆情监测 | 对外一律表述为「他人提及本账号的内容」（见 §11.1） |
| Ask Maps 的说法未经官方确认 | §10 的价值论证不依赖它；即便不成立，信息准确性本身仍成立 |

## 16. 待办

PLAN.md 的开工前验证清单尚未执行，其中四条需要本项目之外的信息：

1. 澳觅自己的 FB / IG 主页现状与最后更新时间
2. 抽 20 家签约商家看有无 Page 及更新频率
3. GCP Console 查 Business Profile API 实际配额（0 还是 300）
4. 内部是否已有人在做社媒相关项目

第 3 条与本设计的取舍无关（已按未批准规划）；第 1、2、4 条影响的是项目是否该继续，
不影响本设计的技术形状。

---

## 附录 A · 已评估但未纳入 v1 的联动可能性

记录在此以免重复评估。每条都注明了状态与不做的理由。

### 可用但额度受限

**Instagram Hashtag Search** —— `/ig_hashtag_search`、`/{id}/top_media`、`/{id}/recent_media`。
每 7 天滚动窗口仅 30 个唯一 hashtag，每次最多 50 条，返回不含用户信息。
该额度做不了监测，只够做选题参考：每周固定查十余个澳门餐饮/旅游相关 tag，
观察内容形态后喂给生成层。v2 候选。

### 可用但成本或审核门槛高

**Meta Webhooks** —— feed / comments / mentions 实时推送。
v1 用轮询，因为 webhook 需公网回调，且 Meta 于 2026-03-31 更换了 webhooks 的 mTLS
根证书（需在信任库中安装 `meta-outbound-api-ca-2025-12.pem`），本地开发起步成本高。
接口留好，v2 切换。

**Messenger / Instagram Direct** —— 离转化最近的一环（「还有位吗」可直接成单），
但权限审核难度最高。README 已将 Messenger API 的权限要求标为未核实，此处维持未核实。

**Google location ↔ 澳觅门店自动匹配** —— 靠地址、电话、名称做模糊匹配。
20 家门店手工绑定可接受，规模到数百家时必须自动化。v1 手工。

### 反向回流到澳觅主业（超出本项目范围，但值得记录）

**`BUSINESS_DIRECTION_REQUESTS` 作为到店意图信号** —— 导航请求量是真实的线下意图，
可反哺澳觅的商圈热度判断与推荐排序。

**Google 评价文本 → 菜品级口碑** —— 评价中提到的菜名与问题聚合成菜品级洞察，
回流给商家运营。比星级有用得多。

这两条的消费方是澳觅主业而非本项目，需要跨团队立项。

### 产品层面值得显式化

**一次 Meta 授权同时拿到 Facebook Page 与 Instagram Business** ——
已隐含在 Meta OAuth 流程中，但产品上应显式呈现为「绑定一次，两个平台」，
这是相对单平台工具可感知的体验差异。

### 已确认关闭

| 能力 | 状态 |
|---|---|
| Google Q&A API | 2025-11-03 停用，官方未点名继任者 |
| Meta Public Feed / 全网 trending | 早已关闭 |
| GBP `reportInsights` | 2023-03-30 停用，替代品为 Performance API v1 |
| Meta Page Insights 旧 impressions 体系 | 2026-06-15 下线，替代品为 Media Views |
