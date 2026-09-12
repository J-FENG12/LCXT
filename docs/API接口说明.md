# 本机 API 接口说明

服务只监听 `127.0.0.1` 的随机端口。页面加载时注入随机 256 位令牌，调用必须满足 Host、Origin/Sec-Fetch-Site 和 `X-Travel-Token` 检查。令牌不写入项目或导出。

## POST `/api/agent`

统一请求体含 `action`。支持：

- `status`：模型可用性与脱敏服务信息。
- `new`：建立最多 30 分钟空闲期的本机会话。
- `extract`：模型整理需求草稿；需要 `sessionId`、`text`、`demo`、`basePayload`。
- `consult`：本地事实咨询；仅 `useModel: true` 时调用模型。
- `evaluate`：确定性评估，不调用模型。
- `confirm`：绑定 `taskHash + selectedPlanId + confirmationId`。
- `generate`：生成服务/营销/产品草稿；只有 `useModel: true` 时调用模型。
- `invalidate`：任务变化后作废确认并取消在途请求。
- `reset`：取消并删除会话。

服务端只允许预定义工具。`confirm` 不接受客户端自称批准来绕过服务端评估；pending/rejected 方案不能建立确认。

## POST `/api/model`

- `{ "action": "status" }`：返回服务商、模型、Base URL 和布尔型 `hasApiKey`，永不返回密钥。
- `{ "action": "save", ... }`：原子写入当前用户配置。远程 HTTP、带凭据 URL、非法模型名会被拒绝。

## POST `/api/shutdown`

停止 Agent、取消会话、关闭连接并释放本机端口。

所有错误返回 JSON `{ "error": "脱敏说明" }`。请求体最大 1 MiB。没有批量上传、预订、付款、发布或外部联系接口。
