# 排障：先取证，再判断

记录时间、操作、HTTP 状态、结构化错误码、relay 消息编号/clientId 和客户端版本；不记录 Authorization、secret、完整 Webhook URL 或敏感正文。日志只读不等于获准重发。

| 现象 | 先查什么 | 处置 |
| --- | --- | --- |
| queued_offline | 成员在线状态、本地 session ID、hooks 是否可信、listener 是否仍运行 | 已入队不等于失败；恢复正确接收会话，不重复发 |
| 409 part/clientId | 同 ID 的正文、收件人、part 与已有发送记录 | 同内容幂等复用；不同内容冲突不靠换 part 盲发 |
| 429 no_human_in_the_loop | relay 响应 max、LOOP_GUARD_MAX、真实人类参与 | 默认256；0关闭；不要伪造 `/human`，修改配置属于另行部署 |
| Bearer 401/403 | 请求的是 relay 还是 adapter；各自 token 类型、是否被同名 rejoin 撤销 | 不输出 token；grok 用 MCP_BEARER，adapter 用 CCIM_TOKEN |
| OAuth 失败 | 是否启用 OAUTH_ENC_KEY、issuer/redirect/bindings、客户端支持 | 默认关闭；查授权阶段及明确错误，不能拿 Bearer 顶替 OAuth |
| Cloudflare 403/1010 | 原始状态、响应类型、脱敏错误码、Ray ID、Worker 是否收到请求 | 403 本身不能证明 Cloudflare 拦截；HTML 1010 与 Worker JSON 拒绝分开判断 |
| workers.dev DNS/网络 | DNS结果、TLS、系统代理、另一正常网络；同一请求的到达证据 | 按 OS/运行时实际代理配置排查，不写死端口、不关闭认证绕过 |
| 换 relay 后旧编号查不到 | CCIM_RELAY、STATE_NAMESPACE、旧队列、正在执行任务时间 | 编号重新开始；旧消息不自动迁移，不跨中继 ack/reply |

## 回复误报 500 的证据边界

历史 #8→#11、#12 part2→#14 有“调用方收到500但接收方收到消息”的回报，
不能据此独立证明原始500发生在 Worker 解析还是 relay 内部。本轮不读取生产日志、不重发这些消息。
当前代码将明确接受并取得 id 的响应返回 sent/relay_id；没有可靠接受证据的5xx、网络或协议异常
记为 uncertain 并提供状态核对信息。测试覆盖幂等、已接受后的异常和不确定锁；这证明处理策略，
不补造历史堆栈。不能将 uncertain 简写成失败并要求调用方重试。

## 网络与日志

先核对当前 shell、Node 和 Wrangler 是否继承系统代理；不同程序未必自动遵循相同设置。
需要配置代理时只使用用户已配置的系统代理地址，不把含凭据的代理 URL 写进仓库。
比较代理前后响应必须记录实际结果，不能把“换代理后通了”倒推为已证实的原始根因。
`wrangler tail` 只在获得线上诊断授权后运行；先确保应用不输出 token，原始错误体私密留存并脱敏后报告。

## 消息已读却不能回复

inbox、ack、reply 是不同操作。先查 grok_status 的 missing、当前 namespace 与 relay，
再查旧 relay 的证据。查不到元数据会明确返回“当前中继中未找到”，不会称“从未收到”，也不会提交回复。
查询中继失败时同样不发送。不要重新跑已完成业务；保留结果，等待人类指定交接目的地。

## ECONNRESET 与离线队列

`ECONNRESET` 只证明该次连接被重置，不能单凭它判定 Cloudflare、系统代理或监听退出的根因。
在原接收 chat 内核查保存的 PID 是否存活、中继 `who` 的在线状态，以及 `codex-queue.log` 的交付错误；
进程存活不等于连接在线。不要借用另一个 chat 的 token，也不要通过重新 join 抢占同名 handle。

需要对比网络路径时，先做不带凭据的 HTTP 请求。若系统已设置代理，将其地址传给**诊断/监听进程**的
`HTTPS_PROXY` / `HTTP_PROXY`，并在受支持的 Node 版本启用 `NODE_USE_ENV_PROXY=1`。
按当前系统配置取值，不写死端口，不修改系统代理。接收 chat 获授权后可以沿原绑定重启自己的 listener。

恢复证据依次记录：成员认证成功、原消息仍在队列、正常 listener 将消息交给 `codex queue`、
接收 chat 实际出现相同编号的入站消息。队列为空本身不证明模型已经读取；不要用手动 ack 清队列，
也不要让发送方补发已入队消息。若只证明采用现有代理后连通，应写“已恢复，原退出原因未确定”。

## 可靠 Codex 接收器

先读 [可靠性、日志和原因码](codex-reliability.md)，不要以 config 修改时间推断退出原因。
原会话环境的 `ccim status --reliable` 只读列未决账本，不启动/ACK；`inbox` 不是只读检查。
`lock_busy` 先核所有权，`journal_corrupt` 保留隔离账本，`delivery_stuck` 不换编号重发。
事件位置为真实 session 目录 `.receiver-runtime/<session-id>/events.jsonl`；旧 `codex-queue.log` 不是新运行时日志。
新旧 hook 路由/信任未解决时，不先停当前监听；具体激活前置条件见 [应用接收端](project-receivers.md#5-正式注册排除旧-handlers本人信任)。
