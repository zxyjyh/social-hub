# Instagram Business

## 权限

```
instagram_business_basic
instagram_business_content_publish
instagram_business_manage_comments
instagram_business_manage_insights
```

## 发布是容器模式

```
createMediaContainer → chunkedMediaUploadRequest → publishMediaContainer
```

## 唯一能自动回评论的平台

`publishPlaintextCommentReply` 是官方接口。这是整个方案里唯一一个
能把「AI 起草 → 人确认 → 自动发出」这条链真正接到公域的地方。

回复必须经人工确认后再发。
