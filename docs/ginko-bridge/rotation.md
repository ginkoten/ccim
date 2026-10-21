# 换电脑、换账号与轮换

先区分身份：GitHub 仓库、Cloudflare 管理账号、relay 成员 token、adapter MCP Bearer、Grok 例程凭据彼此独立。不要因换一个客户端而一律轮换所有密钥。

| 变化 | 必要动作 | 通常不必轮换 |
| --- | --- | --- |
| 换电脑，旧机可信且退役 | 停旧监听；私密迁移 CCIM_HOME 中 config/session 数据前核对新会话 ID；优先在新接收 chat 明确重新绑定；验证后删除旧机私密副本 | 频道 secret、其他成员 token、Worker secrets |
| 旧机遗失或疑似泄露 | 撤销旧 CLI/Cloudflare 登录；轮换泄露的成员凭据与频道 secret；检查同一设备持有的 MCP/Webhook 凭据 | 未在该设备出现的凭据 |
| 换 Codex / Claude 账号 | 建新专用接收会话；停旧监听，撤销旧产品登录；由人确认接管对应 handle | 未暴露的 Grok 和其他成员凭据 |
| 换 Grok 账号 | 在新账号建立例程，更新 Worker 的 WEBHOOK_URL/WEBHOOK_KEY；移除旧例程和 secret；旧账号仍能访问时轮换 MCP_BEARER | CCIM_TOKEN、频道 secret、另两客户端 token |
| 换 Cloudflare 管理账号 | 新建服务/存储并迁移；新账号登录权限另行授予，Worker secrets 重新安全录入 | 不能假设旧 Durable Object 数据或 Worker secrets 自动跨账号搬迁 |
| 仅更换同一数据后端的入口域名 | 核对实际指向同一存储，再更新客户端地址；OAuth issuer 改变要重新连接 | 成员 token 通常不必变；不能仅凭域名类似判定存储相同 |
| 新建另一 relay | 新建频道/成员 token；adapter CCIM_RELAY/CCIM_TOKEN/STATE_NAMESPACE 一起更新；按下方交接 | 旧 relay 队列不能当成新队列；消息编号不能复用 |

## 同名 handle 不是登录别名

`join` 不带 `ifAbsent` 时会生成新 token，旧连接/凭据会失效；不要用它探测成员是否存在。
常规重建一律 `--if-absent --must-exist`，占用即停，不改名字逃过冲突。
只有人在确认旧接收会话已停、待办已移交后，才能明确授权接管，按 CLI `join` 的当前实现执行。
新 token 必须同步到该客户端；grok 的新 token 放 adapter `CCIM_TOKEN`，不要交给模型。
当前 relay 没有原地轮换频道 secret 的 API。若频道 secret 泄露，需要人类决定迁移到新频道/新 relay，
或在备份、完成待办并明确授权后删除重建原频道；删除会清空队列，不能当作常规轮换步骤。
仅重新加入同名成员会轮换该成员 token，但不能阻止持有旧频道 secret 的人再次接管。
成员 token 泄露且频道 secret 仍安全时，只需经授权重新绑定对应成员。

## 保留正在处理的任务

1. 暂停派发新任务，列出旧 relay 待办、处理中的编号、结果文件位置和未确定发送。
2. 在原 relay 完成/交接已开始任务；不要跨 relay 直接回复或 ack 原编号。
3. 新建 relay 的编号会从新存储开始。adapter 新 STATE_NAMESPACE 隔离 inbox/reply/send 状态；
   旧状态保留供取证，不自动迁移成新编号。
4. 普通重新部署同一 Worker/namespace 不应清空 Durable Object 存储；换 Worker、迁移类或
   namespace 是另一件事。先核对配置差异再判定“消息丢失”。
5. 对 uncertain 发送保留记录、接收方证据和 clientId。换地址/namespace 不能用来绕过不确定锁。

## 凭据放在哪里处理

- Cloudflare：在部署目录用 `wrangler secret put NAME` 的隐藏输入或受控 stdin；执行会更改线上服务，须另获部署授权。
- 本机：CCIM_HOME 的 config/session 文件按私密备份处理；不要输出、提交或贴聊天；备份也要限制权限。
- Grok：账号自己的 secret store 与例程配置；旧账号移除凭据后再关闭旧例程。
- OAuth：新 issuer 或泄露时撤销授权并重新连接；OAUTH_ENC_KEY 轮换会影响已有加密状态，先读上游 OAuth 设计与部署测试，不能随意替换。
