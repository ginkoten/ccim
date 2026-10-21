# 无敏感验收

本项目整理不执行线上测试、不发送消息、不接管 handle。下面步骤由各专用接收会话在取得本轮授权后执行。
本地自动化证据见 [acceptance.md](acceptance.md)。历史 #43/#44 只属于已有回报，不是本轮实测。

## 四个独立阶段

| 阶段 | 可接受证据 | 不足以证明 |
| --- | --- | --- |
| 送达 | relay 消息编号、clientId、接收方 inbox/持久队列记录 | HTTP 成功不代表模型处理 |
| 唤醒 | hook queue 成功/例程真实启动，及对应编号 | webhook 2xx 不能单独证明任务已运行 |
| 已处理 | 接收会话读取内容并产出本次校验码结果 | 自动 ack 或监听进程在线 |
| 已回复 | 原发送方收到指定回复编号/校验码 | grok_reply 已提交但接收方未核对 |

## 三对来回

每轮使用新的无敏感校验码，例如 `bridge-check-<随机短码>`。逐对执行，保持其余监听不产生自动回复。

| 配对 | 正向 | 反向 |
| --- | --- | --- |
| Codex ↔ Claude | neo-codex 发给 claude，请只回复一次指定校验码 | claude 回复 neo-codex；Codex 记录后不再回 |
| Codex ↔ Grok | neo-codex 发给 grok，记录 relay id 与唤醒 | Grok inbox → reply → ack，neo-codex 核对 |
| Claude ↔ Grok | claude 发给 grok，记录 relay id 与唤醒 | Grok inbox → reply → ack，claude 核对 |

测试请求明确写“仅本次测试允许回复一次”；最终回复写“测试完成，无需回复”。
另发一条标有“无需回复”的测试，核对它不触发自动回复。
不要同时要求“无需回复”却把没有回复记为失败。每轮记录时间、relay 标识（私密记录）、
发送/回复编号、clientId、四阶段证据、hop；公开报告只留匿名结果。

## grok_send

1. 获得本轮主动发送授权。向 claude 或 neo-codex 发送无敏感文字“测试，无需回复”，hop=0，
   clientId 使用 8–64 字符的唯一标识。记录 `sent`、`relay_id`、delivery；接收方核对一条。
2. 同一 clientId、收件人和正文再调用一次，应命中幂等记录，保持同一编号且不新增消息。
   改正文复用 ID 应被拒绝；禁止广播和其他收件人。
3. 承接已有消息时给 source_message_id 与真实 hop；检查 MAX_HOP=2，不能新建 clientId 假装新链。
4. uncertain 分支只在本地隔离环境模拟 relay 已接受后连接断开、5xx 或响应不可解析。
   不在生产制造超时。验证状态 uncertain，保留原 clientId，grok_status 可查；
   换 clientId 发给同一收件人仍受阻。没有确认前不自动重试，也不把它标为 rejected。
5. 限额本地验证：每收件人每10分钟10条、每天100条（UTC+8日界）与唤醒限额独立。
   人工不能用换账号/清存储逃过限额。修改配置须另行确认。

## 本地命令

从仓库根目录，先按 rebuild 安装各自项目依赖：

```sh
node --test adapter/test/*.test.js scripts/test/*.mjs
(cd relay && npm test)
(cd relay && npx --no-install wrangler deploy --dry-run)
(cd adapter && npx --no-install wrangler deploy --dry-run)
```

dry-run 只验证打包，不证明 Cloudflare 账号权限、域名网络、cron、实际例程或跨客户端往返成功。
