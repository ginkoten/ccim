# Codex 接收可靠性（可选启用）

`CCIM_RELIABLE_CODEX=1` 仅选择 Codex 可靠监听，默认 listener 与 Claude waker 不变。
部署单位是 `plugin/bin/ccim` 和全部 `plugin/lib/*.cjs`，保留原相对路径，使用独立版本运行目录，不替换共享插件缓存。
[应用接收步骤](project-receivers.md)负责真实身份、旧 handler 排除、正式信任；源码存在不代表现场启用。

## 进程所有权

session 文件先 realpath，默认 home 的链接与项目 home 的同一绑定共用 `.receiver-runtime/<session-id>`。
原子硬链接发布完整 owner 记录，保存 PID、进程启动标识和 runId。Linux 使用 boot ID + start ticks，其他系统使用 `ps lstart`。
已死或启动标识不同的旧 owner 可以被原子继任；多个争抢者只有一个成功。正常释放写入对应 runId 的 released 记录。
`owner.lock` 和 `owners/*.next` / `*.released` 组成不可变继任链，迟到的旧进程释放不会解锁新进程。

存活且无法核实身份的旧 owner 保守拒绝接管；旧记录无指纹且 PID 已被复用可能仍需人工核实。
macOS 的 lstart 是秒级，不能声称能区分同一秒内的极端 PID 复用。读取不到进程元数据时 fail closed。
链超过10000代、owner 损坏或无法读取时停止并记录固定错误，不自动删除锁、不凭 PID 文件杀进程。
CLI 的可靠存活判定使用指纹；SessionEnd 只有指纹精确匹配才发停止信号，不自动 rejoin 或拉起替代身份。

## 世代隔离与投递账本

`delivery-<sha256>.json` 的世代来自 relay、channel、成员 token 的哈希；文件与 queue 去重 ID 不包含原 token。
成员重新创建/令牌更换产生新世代，避免重复的 relay 消息 ID 被旧 acked 记录吞掉。
有旧 `delivery.json` 时保守进入迁移核对，不能猜它属于新世代。不要复制其他会话账本作为恢复方法。

写前日志先持久化 uncertain，再调用官方 app-server `thread/queue/add`；确认接受后保存 accepted，最后 ACK。
ACK 失败只重试 ACK。首次 not_sent 消息直接 queue/add，不读整段历史。
可能已经提交的消息只核对：最多5页 queue（每页100条），再查最多3页 turns（每页20条），单个 RPC 缓冲上限16MiB。
queue 只匹配 `clientUserMessageId`；turns 只匹配 `userMessage.clientId`。正文、assistant 内容、伪造 marker 都不是成功证据。
使用 `thread/turns/list` 分页而非无界 `thread/read`。所用字段与已核对官方 schema 对应，未知版本协议仍需实际兼容性验收。
无命中、响应过大、页数耗尽或不支持协议时保持 uncertain，不据“没看到”重发。

账本无法解析/结构无效时先创建 `.recovery-required` 标志，再把原件隔离为 `.corrupt-*`，保存空的 quarantine 账本。
保留所有未知消息为只核对状态；绝不因重建空账本直接重发。初始化失败也释放本轮所有权。
这些文件留在私有运行目录，不提交或公开；不要手工清掉恢复标志来解除保守状态。

uncertain 核对从15秒指数退避，最大15分钟；8次未解决变成 stuck，无自动 resend/ACK。
accepted 的 ACK 失败不消耗投递次数。只读状态入口，在原会话既有身份环境中使用：

```sh
node "/ABSOLUTE/RUNTIME/plugin/bin/ccim" status --reliable
```

它只读取账本，列出未决消息编号、状态、尝试数与时间，不写状态、不启动 listener、不拉 inbox 或 ACK。
当前不自动清理7天前 acked 记录：relay 过期重现和迁移边界尚未验证，不能通过清理降低去重保证。
账本和继任链会增长，保留容量监测；自动压缩/清理需单独设计和迁移验证。

## Focus、重连与退出

可靠模式的 Stop 不走旧 focus flush；focus 开启时输出 `reliable_focus_flush_unsupported`，不读取/ACK积压。
在获准的原接收会话执行 `ccim focus off` 后，relay 将积压经 WebSocket 交给同一可靠投递账本。
默认旧模式的 focus 行为保持兼容；不能同时让新旧消费者处理同一个 session。

网络错误、握手超时、心跳丢失可在同一进程重连。只有连接稳定至少60秒才重置重连退避；短连接继续指数增长，基础上限30秒、另加0–20%抖动。
队列失败不关闭 socket，后续排空遵守账本退避。401、4001/4002/4003、SIGTERM/SIGINT 会终止；不自动复活、不覆盖 SessionEnd。
SIGKILL 没有退出日志；应用退出、睡眠、重启是不同场景，单次联网不能证明永久在线。

## 日志与原因码

日志位于真实 session 目录的 `.receiver-runtime/<session-id>/events.jsonl`，1MiB轮转，保留一份前档。
目录0700、文件0600；仅固定事件、受限错误码、session/run ID、PID与数值，不记录消息正文、token、URL、完整环境或原始异常。

| 码/事件 | 含义与下一步 |
| --- | --- |
| `lock_busy` | 已有/无法排除活 owner；核实指纹，不另起监听 |
| `lock_reclaimed` | 已核实旧 owner 失效，原子继任成功 |
| `lock_corrupt` / `lock_history_limit` | 人工核对私有元数据，不能删锁抢占 |
| `journal_corrupt` / `journal_legacy_hold` | 保留隔离账本，官方证据核对后再决定迁移 |
| `delivery_stuck` | 达到未解决次数，使用只读 status，禁止换编号重发 |
| `queue_page_limit` / `history_page_limit` | 有界核对耗尽，未证明不存在 |
| `rpc_response_too_large` / `rpc_timeout` | RPC 未取得可靠结果，保留 uncertain |
| `runtime_error` | 仅记录安全 code；`unclassified` 不猜原因 |
| `session_mismatch` / `project_mismatch` / `project_unavailable` | hook 路由跳过；核 session 和 realpath |
| `legacy_handlers_not_excluded` | 候选前置条件未满足，旧监听保持原状 |
| `system_proxy_failed` / `system_proxy_unsupported` | 检查代理模式/平台，不输出代理值 |
| `hook_deadline_exhausted` / `hook_child_timeout` / `hook_child_failed` | 固定失败码；代理查询已计入 start/prompt 4.5秒、stop 9秒、end 2.5秒总预算 |

不要把缺终止日志、其他成员 join、config mtime 或 PID 消失直接解释为退出原因。

## 验收与回退

fixture 测试覆盖 SIGKILL 测试子进程、并发争抢、账本损坏、伪造 marker、有限分页及 hook 参数，不触碰真实接收器。
上线必须另验唯一 owner、who、真实入聊、完全退出后原应用 hook 恢复与新 PID 的空闲窗口。
历史现场 evidence 与本轮 fixture 分开，见 [验收记录](acceptance.md)。
回退只停止经指纹确认的目标 listener，保存账本和事件；uncertain 未核对前不可换回不懂账本的旧消费者。
工作站同步、Claude 接入、永久 hook 激活另按明确范围批准，不因本分支修复自动执行。
