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
有旧 `delivery.json` 时对恢复时的未确认消息保守核对，不能猜旧账本属于当前世代。不要复制其他会话账本作为恢复方法。
**同一 relay 换域名别名也会换世代**；改地址前须核清旧世代全部 uncertain/stuck，并保存已接受证据。未核清时不要改地址绕过阻塞；本轮未实现跨别名迁移。

写前日志先持久化 uncertain，再调用官方 app-server `thread/queue/add`；确认接受后保存 accepted，最后 ACK。
ACK 失败只重试 ACK。首次 not_sent 消息直接 queue/add，不读整段历史。
可能已经提交的消息只核对：最多5页 queue（每页100条），再查最多3页 turns（每页20条），单个 RPC 缓冲上限16MiB。
queue 只匹配 `clientUserMessageId`；turns 只匹配 `userMessage.clientId`。正文、assistant 内容、伪造 marker 都不是成功证据。
使用 `thread/turns/list` 分页而非无界 `thread/read`。所用字段与已核对官方 schema 对应，未知版本协议仍需实际兼容性验收。
无命中、响应过大、页数耗尽或不支持协议时保持 uncertain，不据“没看到”重发。

账本无法解析/结构无效时先创建 `.recovery-required` 标志，再把原件隔离为 `.corrupt-*`，保存空的 quarantine 账本。
持有独占锁后、连接 WebSocket 前，通过原始 HTTP `GET inbox?all=1` 取得当前全部未确认 ID（含 focus 积压），
持久化为 `recoveryIds`。该 HTTP 查询没有 ACK；它不同于会取件并 ACK 的 CLI `ccim inbox`。
只对这份固定集合中没有确定状态的消息执行核对；快照之后的新 ID 正常投递。已有 uncertain/stuck 不因快照解除，已有 not_sent/accepted/acked 按各自确定状态处理。
边界只存 ID、不存正文，重启不重新扩张；旧全局 quarantine 账本升级时也只补一次边界。边界获取失败时拒绝启动投递，记录 `recovery_snapshot_failed`，释放锁，不把失败当空 inbox。
即使旧账本全部 acked，也不盲信它覆盖当前世代；恢复快照中的未确认消息仍保守核对，快照后的新消息不受牵连。
这些文件留在私有运行目录，不提交或公开；不要手工清掉恢复标志来解除保守状态。

uncertain 核对从15秒指数退避，最大15分钟；8次未解决变成 stuck，无自动 resend/ACK。
accepted 的 ACK 失败不消耗投递次数。只读状态入口，在原会话既有身份环境中使用：

```sh
node "/ABSOLUTE/RUNTIME/plugin/bin/ccim" status --reliable
```

它只读取账本，列出世代指纹 `generation`、恢复 ID 集合、未决消息编号、状态、尝试数与时间，不写状态、不启动 listener、不拉 inbox 或 ACK。
当前不自动清理7天前 acked 记录：relay 过期重现和迁移边界尚未验证，不能通过清理降低去重保证。
账本和继任链会增长，保留容量监测；自动压缩/清理需单独设计和迁移验证。

## stuck / 隔离条目的人工处理

以下是取得具体批准后的操作者流程，**本轮只用 fixture 验证，未对真实账本执行**。

1. 先在原接收对话的真实身份环境中运行 `status --reliable`，核对频道、世代和单条消息编号。
   用官方队列/会话元数据或接收方结果核实已投递；有限历史“没查到”不是未投递证明。
2. 通过产品支持的单会话方式暂停该接收器自动启动入口，并正常停止经身份核实的原监听；等待退出及独占锁释放。
   不杀未知 PID。没有单会话暂停能力就不强行实施；已活跃/未知 listener 或活 owner 都会使命令失败。
3. 只选一个 ID 和一个决定，带上只读状态中的当前世代哈希，执行下列二选一命令。占位符须替换；不要批量循环。

```sh
# 已有充分已投递证据：明确确认这一条可走 ACK
node "/ABSOLUTE/RUNTIME/plugin/bin/ccim" reliable resolve <id> --delivered --confirm-delivered --generation <hash>
# 无法确认投递，但操作者明确承担可能重复的风险：允许这一条重投
node "/ABSOLUTE/RUNTIME/plugin/bin/ccim" reliable resolve <id> --resend --confirm-duplicate-risk --generation <hash>
```

命令使用当前正式会话绑定并核对世代，再取得与监听**同一原子所有权锁**；不改绑定，不绕过活 writer，不启动进程，不做网络操作。
它只将指定条目设为 accepted（delivered）或 not_sent（resend），保留其他条目及隔离边界，写入固定 `manual_resolution` 审计事件。
结果 `staged:true, networkActions:0` 表示决定已保存，**不代表已投递或已 ACK**。
未知 ID、旧世代、已 acked 条目均拒绝；已 accepted 条目拒绝 resend，应只继续原 ACK。
指定条目必须已在账本中或固定 recoveryIds 中；无法读取/验证账本时拒绝操作，不自动创建空账本放行。

4. 用只读 status 核对决定；按批准流程恢复原应用可靠监听。下一次收到同 ID 时，accepted 只 ACK 该条，not_sent 经正常写前日志投递后才 ACK。
   ACK 失败保留 accepted；queue 结果不确定仍按原 uncertain 规则核对。若 relay 已无该消息，不伪造正文或新消息号补发。
   原进程退出后再处理；禁止编辑尚被运行中 listener 缓存的账本。

## 继任链达到上限的维护（仅条件式人工流程）

`lock_history_limit` 不授权删锁。当前没有自动压缩命令；下面只用于另获维护批准、可证明全部写入者已停止的情况：

1. 定位该 session 的真实 runtime 目录；经正式产品入口关闭这个 session 的全部自动启动路径，包括旧/新 hooks 和外部 launcher，其他会话不动。
   如无法做到单会话暂停，就保留报错并报告能力缺口，不继续文件操作。
2. 核对链尾的 runId、PID/启动指纹和 released 状态，并确认该目录全部持有者/竞争启动已退出。
   不能只看一个 PID 不在或仅看 released 文件；未知进程身份、链损坏、并发启动未排除均停止。
3. 在不再有任何 writer 的维护窗口，为**该 session**创建同文件系统私有归档目录，备份账本/恢复标志/事件并记录哈希。
   将 `owner.lock` 与完整 `owners/` 一并移入归档（不删除、不只移其中一项）；任何一步失败都保持启动路径关闭，恢复这对文件后再调查。
   `delivery-*.json`、`delivery.json`、`.recovery-required`、隔离原件与事件日志保留原位、原权限，不清空去重记录。
4. 再次核对无 writer 和归档完整，才按批准流程恢复唯一原应用入口；新 owner 将从空链原子创建。
   核对唯一 PID/指纹和未决账本、消息验收；有 uncertain 时不能改回不识别账本的旧消费者。

这不是在线原子压缩；安全性依赖先排除所有启动/写入者。本轮未实施或宣称现场验证，不能把归档步骤当成无需停写的通用修锁命令。

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
| `journal_corrupt` / `journal_legacy_hold` | 保留原件，固定恢复 ID 边界，边界外新消息正常投递 |
| `recovery_snapshot` / `recovery_snapshot_failed` | 边界已保存 / 未取得可靠边界，失败不投递 |
| `manual_resolution` | 单条决定已保存；尚非投递或 ACK 回执 |
| `resolution_listener_active_or_unknown` / `lock_busy` | 未排除活写入者，不能人工改账本 |
| `resolution_generation_mismatch` / `resolution_entry_unknown` | 世代或条目不匹配；重新只读核对，不换ID猜测 |
| `delivery_stuck` | 达到未解决次数，使用只读 status；按上述逐条确认流程处理，禁止换编号盲重发 |
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
