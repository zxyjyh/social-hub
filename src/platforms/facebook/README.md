# Facebook Page

## 权限（全部需要 App Review，但开发者模式下对有角色的用户免审）

```
pages_show_list
pages_manage_posts        发帖
pages_read_engagement     读互动
pages_read_user_content   读评论
pages_manage_engagement   管理评论
pages_manage_metadata     管理主页信息
read_insights             读数据
```

## 关键事实

- Graph API **v23.0**
- **Page token 不过期**。60 天只对 User token 和 IG token 成立——刷新逻辑要按 token 类型分别处理，不要一刀切
- 开发者模式下发的帖子**可能仅对有角色的人可见**（实践报告，非官方文档）。演示前把评委加成 tester

## 发布链路

```
文字/图片   publishFeedPost / publicPhotos
视频        initVideoUpload → chunkedMediaUpload → finalizeMediaUpload → publishVideo
Reels       initReelVideoUpload → uploadReelVideo → publishReel
Story       initStoryVideoUpload → uploadStoryVideo → publishVideoStory
```

## 不做

自动点赞/收藏/关注/养号。违反平台政策，且澳觅是持牌平台，碰了是品牌自杀。
