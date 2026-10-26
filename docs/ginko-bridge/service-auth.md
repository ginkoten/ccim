# 服务成员鉴权：取证、停止与恢复

成员 token（adapter → relay）、MCP_BEARER（Grok → adapter）、OAuth grant、Webhook key 是不同身份。
当前 direct relay 成员 token 没有 TTL。旧 token 的 401 可能来自显式同名 join、leave、频道删除、
错误 relay/成员绑定或错误凭据；单凭 401 不能判断是哪一种。重复同名 join 会保留成员、替换 token，
因此不能单独解释“完整成员列表里该成员缺失”。online=false 仅代表没有 WebSocket。

## 复用已有身份

普通 CLI/hook 启动读取已有 session，不调用 join。`scripts/provision-grok.mjs` 已强制
`ifAbsent:true,mustExist:true` 并以 wx/0600 保存输出；占用、网络异常均停止，不覆盖、不重试。
CLI 显式 join 保留已有 takeover 语义，服务维护必须带两个 guard。没有新建服务自动接管入口。
不要因 listener 离线、MCP tools/list 成功或凭据文件修改时间推断成员 token 是否有效。

## 健康检查

`GET /health` 仍只表示 Worker 存活。`grok_status({})` 读取最近 poll 和持久化 auth stop，
不验证当前下游身份。`grok_status({"health":true})` 单独调用：

- MCP HTTP 401：入口身份未通过，还没有执行下游查询。
- MCP 成功时返回 `summary.health.binding`：channel、handle、relay_mode、relay_origin、state_namespace。
- direct 且未停止时只做一次 `GET who`，校验返回 `you` 等于配置 handle；`downstream.ok/status/reason`
  表示这次只读检查。online=false 不影响 token 验证。
- 已停止时报告 `downstream_auth_blocked`，不请求下游、不清故障；健康检查本身也不写 journal。
- author-mcp 的只读检查返回 501，不进行 OAuth refresh。原有 OAuth 业务刷新策略保留；刷新网络错误
  记为 network/0，不能伪装成成员401。

`node scripts/check-adapter-mcp.mjs` 使用既有环境变量 `CCIM_ADAPTER_MCP_URL` 和
`CCIM_ADAPTER_MCP_BEARER`，现在输出入口、非秘密绑定、下游及最近 poll 各层结果。
它需要支持 health 参数的 adapter；旧版返回 status_unavailable，不会冒充下游健康。
只通过现有受控环境注入凭据，不贴入参数、日志或聊天。脚本成功退出表示检查完成，
仍须检查 `downstream_auth.ok`；false/null 不是恢复。

## 401 后保留任务并停止无效请求

peek、ack、send 遇下游401后写 `auth:<binding hash>`，保存固定原因码、层、操作和时间。
key 由 relay/channel/handle/mode 组成，并位于现有 STATE_NAMESPACE 内，不含 token 或其 hash。
后续 cron、inbox、ack、send 不再访问下游；重建 Adapter 实例、普通重新部署、只换 token 均不自动恢复。
最近 poll 保留故障时刻，不被每分钟的跳过覆盖。网络、5xx 不触发401停止。
本修复不引入防循环状态查询；兼容既有 relay。

鉴权停止不删除 msg/open/reply/send/send-pending、原 clientId、sent 接受回执或 uncertain 记录。
恢复身份不代表任务要重跑。uncertain 必须核对接收方证据，不能换 clientId、reply part 或 namespace 绕过。
改变 relay/member/namespace 属于身份迁移，要另行核对旧账本，不能当作解锁方法。

## 明确批准后的单次恢复检查

恢复由既有 Worker 配置中的非秘密 `AUTH_RECHECK_APPROVAL` 标记控制，默认未配置。
先取得明确针对该 Worker/成员的一次验证及恢复批准，再通过获准的既有部署流程设置唯一批准编号。
不改凭据、不改 namespace、不创建管理服务；公网 Worker 和 MCP 不提供恢复或清除接口。
approval_id 是人工批准的关联编号，不是凭据；仅具备 MCP Bearer 的调用者不能设置部署变量。
不能自行生成编号代替批准；本文是维护流程，不自动授权部署或配置修改。

下次 cron 先持久化 checking 和去重编号，再只发一次 direct `GET who`。只有身份正确才解除停止；
401、网络错误、错误 handle 均保持停止。同一批准编号不能重复执行，包括换进程；并发请求只能有一个探测。
验证成功的 tick 不继续读取消息；正常业务轮询到下一次 cron 才恢复。失败后保留同一变量不会持续请求；
再次尝试必须取得新批准并换新编号，单独更换 token 不会重用已消费编号。
若检查中途崩溃，保留 checking，不自动重试；只换新批准编号仍返回 recheck_outcome_unknown。
人工核对后，可明确批准接替这次未完成检查：设置新的 `AUTH_RECHECK_APPROVAL`，并同时设置
`AUTH_RECHECK_SUPERSEDES=<当前checking的approval_id>`。两者必须不同，目标必须精确匹配当前未完成检查。
同一事务内将旧尝试标记superseded并保留原字段、接替编号/时间，再登记新尝试；并发接替只有一方能发出探测。
最终结果写入时再次核对当前有效批准编号。旧请求迟到只附加到旧尝试的late_result，绝不覆盖新检查或解锁/重锁。
新尝试若再中断，需再次明确批准并指向新的checking编号；不能沿用旧接替目标或自动换号。
若新尝试已明确返回failed，下一次普通恢复批准应移除旧AUTH_RECHECK_SUPERSEDES；该字段只用于接替当前checking。
不得删除auth key、历史尝试、发送账本或修改namespace实现恢复。接替操作与正常恢复一样，会在验证成功后恢复后续cron。
OAuth 恢复不走该标记，返回 oauth_recovery_requires_operator。

以上只是恢复机制代码，不能替代具体 Worker/成员的凭据操作批准。

## 非秘密成员生命周期审计

relay 在同一存储事务中提交身份变更和审计：join、replace、leave、remove（频道删除时各成员）、delete。
仅保存 channel/member/action/at/generation/reason/sequence；不存 token、hash、secret、请求头、正文或操作者猜测。
拒绝的 guarded join 不改变身份或审计。generation 是该频道自本实现启用起的递增成员代次；旧成员未知为 null。

`GET /c/<channel>/lifecycle` 沿用该频道成员 token 鉴权，只读返回最多256条事件，按 sequence 排序。
它不能跨频道查询，不能识别持有相同频道 secret 的实际操作人。频道删除仍撤销全部身份、清空队列和去重数据，
但保留有界非秘密审计与 generation；删除后旧 token 不能读取，重建后的合法成员可以看到保留历史。
此保留语义与旧 deleteAll 不同，部署前需审查；仍不能将 delete 作为轮换或排障手段。
审计有256条上限，不承诺永久留存，也不能追补部署前丢失的历史。

## 部署与回滚边界

adapter 可单独发布到获准的目标 Worker；共享源码不代表获准更新工作站 adapter。
relay 审计是共享中继变更，会影响所有频道，必须单独批准部署并检查配置/迁移。
代码未增加凭据、外部服务、常驻进程或依赖，也不修改 DO namespace。

当前分支包含既有 #138 查询与更早的 LOOP_GUARD_MAX 实现；历史线上 relay 使用 LOOP_GUARD=off。
新代码不读取旧 `LOOP_GUARD`；仅保留 `LOOP_GUARD=off` 仍会因新变量缺失而启用默认256阈值。
若获准采用新实现且要保持当前关闭行为，必须在实际部署配置显式设置 `LOOP_GUARD_MAX="0"`，
并分别验证构建/版本的有效普通绑定与实际阈值为0；检查查询不清零streak、既有计数/队列/去重状态保留。
离线回归应覆盖超过24及256次发送仍不因防循环拦截；任何线上发送验证须另获明确批准。
这属于明确的变量迁移及共享relay发布动作，本轮未执行，不能仅靠保留旧off声明行为不变。

回滚代码应保留现有存储和命名空间。旧 adapter 不认识 auth stop，回退将恢复无效 cron 重试；
旧 relay 的 deleteAll 会抹去新审计。回滚前须明确接受这两项行为后果，不删除发送/回复账本。
