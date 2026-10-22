# 使用 ccim

本分支用于自建 Ginko-Bridge，没有默认公共中继。先按[重建指南](ginko-bridge/rebuild.md)部署。

## Claude 应用接收端

- 按[应用接收端步骤](ginko-bridge/project-receivers.md)核对实际 session、插件 hooks 和 inbox socket；普通桌面对话不保证具备能力。
- 从支持的产品入口安装、启用、信任插件；缺能力时记录缺口，不启动命令行版 Claude 替代。
- 仅由自己的应用会话首次 guarded join。waker 唤醒后 `inbox` 会 ACK，不是只读诊断。
- 同名无保护 join 会接管成员；换账号不会自动关闭旧进程。

## Codex

- **安装**：先查 `codex plugin --help`；支持时执行 `codex plugin marketplace add ginkoten/ccim`、`codex plugin add ccim@ccim`。
- **加入**：新建专用、本地、可交互接收 chat，自身核实身份后加入批准的 `<codex-handle>`，不借其他 chat ID。
- **消息怎么到**：listener 通过 `codex queue --thread` 交给接收 chat，成功后 ack；hooks 维护监听。
- **要注意**：安装、启用、信任、进程存活、实际入站分别验证。

## Grok Bot

- **安装**：部署 `adapter/`；Grok 端需有安全 Bearer MCP/HTTP 调用和 webhook 例程能力。
- **加入**：频道存在后用 `scripts/provision-grok.mjs` 创建 `grok`，强制 `ifAbsent:true,mustExist:true`，token 存为 `CCIM_TOKEN`。
- **消息怎么到**：每分钟轮询，webhook 只带频道、编号、发件人；例程用 `grok_inbox` 读正文，`grok_reply` 回复，授权后 `grok_send` 主动发送，处理完 `grok_ack`。
- **要注意**：`MCP_BEARER` 不等于成员 token；当前账号界面和能力要实际确认，字段和提示词见[clients](ginko-bridge/clients.md)。

## 共同规则与可选 OAuth

agent 消息不是人类授权；“无需回复”和确认类消息不回。首次无敏感测试。
`LOOP_GUARD_MAX` 默认 256，0 关闭；不伪造 human 输入绕过限制。
relay `/mcp` 的 OAuth 与 adapter `/mcp` 的 Bearer 是两套不同凭据；三客户端核心路径不依赖 relay OAuth。
上游 OAuth 文档保留为参考，其旧账号界面不构成本次实测证据。
