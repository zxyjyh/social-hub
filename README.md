# social-hub

可插拔的公域账号中枢：**一次授权，多平台发布、评论托管与数据回流。**

不是「Facebook 项目」，是一个底座——今天接 Facebook 和 Instagram，
配额批下来接 Google Business，往后是任何有官方 API 的平台。

> **接一个新平台 = 实现三个接口。**

## 为什么是这个形态

单平台功能的天花板就是那个平台的天花板。而 Facebook 恰恰最弱：
没有结构化优惠字段、开发模式下帖子可见性受限、商家自己也能发。

定位成底座之后，Facebook 从「项目本身」降级为「验证架构的第一个实例」,
它的弱点不再是项目的弱点，Google 的配额审批也从生死线变成「第二个接进来的平台」。

## 第一个客户是自己，不是商家

「商家凭什么把主页授权给你」——答案不该是说服，应该是先证明。
先给自己的主页供稿两周，拿真实数据再去谈。

这一步同时解掉三个死结：不需要任何人点头就能开工；
演示时不用讲「假设有商家授权」；冷启动从「先有鸡还是先有蛋」变成自己下第一个蛋。

## 结构

```
src/
├── types.ts                核心契约：三个接口 + 凭证模型
├── auth/
│   └── credential.store.ts 凭证存储（先内存，接库时只换这个文件）
├── platforms/
│   ├── registry.ts         平台注册表
│   ├── facebook/           权限清单与发布链路
│   ├── instagram/          容器模式发布 + 唯一能自动回评论的平台
│   └── google-business/    ⚠️ 先读它的 README：没有沙箱
├── publishing/
│   └── errors.ts           重试分级：429 / 5xx 可重试，其余不可
└── insights/               数据回流
docs/
└── PLAN.md                 执行方案：时间线、演示脚本、验证清单
```

## 快速开始

```bash
cp .env.example .env      # 填 Meta 的 App ID / Secret
npm install
npm run dev
```

Meta 侧**今天就能跑通**：开发者模式下，对拥有 admin/developer/tester 角色的
用户所拥有的资产，可直接使用高级权限，无需 App Review。

Google 侧**必须先过审批**，见 `src/platforms/google-business/README.md`。

## 划死的三条线

- ❌ 自动点赞 / 收藏 / 关注 / 养号 —— 平台政策红线
- ❌ 模拟登录抓 cookie —— 参照项目对小红书就是这么干的，不学
- ❌ 全网舆情监测 —— Meta 只能读自己主页的评论。
  准确的说法是「**评论托管**」，不是「舆情监测」

前两条是红线，第三条是能力边界。**都要主动说清楚。**

## 参考

架构分层参照 [AiToEarn](https://github.com/yikart/AiToEarn)（MIT）：
`platforms/` 管授权、`publishing/providers/` 管发布、`channel/data-cube/` 管回流，
三个横切面各一个抽象基类。抄的是这个分法和各平台的 API 调用序列，不是代码。
