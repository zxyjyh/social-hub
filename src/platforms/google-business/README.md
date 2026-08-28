# Google Business Profile

## ⚠️ 没有沙箱，先过审批

新建 GCP 项目默认配额 **0 QPM** —— 一次成功调用都发不出去。
必须通过 https://support.google.com/business/contact/api_default
提交 "Application for Basic API Access"，人工审批后提到 300 QPM。

**OAuth 的 test users ≠ API 配额。** 授权成功不等于能调通。

资格前置：
- 管理一个**已验证且活跃满 60 天**的 Google Business Profile
- 该 Profile 要有代表该业务的网站
- 用 GBP 上 owner/manager 的邮箱提交，填 GCP 的 **Project Number**

审批时长口径不一：官方 7–10 个工作日；实践报告 4 天到 6 周。
已知坑：即使 Basic Access 批了，同族 Account Management API 配额仍可能为 0，
而 `accounts.list` 是整条链第一步。

**查是否已批**：GCP Console → IAM & Admin → Quotas →
筛选 `mybusinessbusinessinformation.googleapis.com`，0 还是 300。

## Scope

```
https://www.googleapis.com/auth/business.manage
```

## 端点

```
GET   mybusinessaccountmanagement.googleapis.com/v1/accounts
GET   mybusinessbusinessinformation.googleapis.com/v1/{account}/locations
        ?readMask=name,title,storefrontAddress,profile
POST  mybusiness.googleapis.com/v4/{location}/localPosts
GET   mybusiness.googleapis.com/v4/{location}/localPosts/{postId}
```

## localPost 结构（这是 Google 相对其他平台的独特价值）

```ts
{
  languageCode: string,                      // 多语言原生支持
  topicType: 'STANDARD' | 'EVENT' | 'OFFER',
  summary?: string,
  media?: [{ mediaFormat: 'PHOTO' | 'VIDEO', sourceUrl }],
  callToAction?: { actionType, url },        // 官方允许外链
  offer?: {
    couponCode?: string,                     // ← 对上澳觅的第三方 coupon 管理
    redeemOnlineUrl?: string,
    termsConditions?: string
  },
  event?: { title, schedule: { startDate, endDate, ... } }
}
```

返回的 `searchUrl` 是**公开链接**——评委可以掏手机在 Google Maps 上验证。

`localPosts` 未列入日落计划；`reportInsights` 已于 2023-02-20 停用。
