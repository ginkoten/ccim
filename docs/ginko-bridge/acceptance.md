# 重建项目验收记录

## #79 范围补充：安全准备记录（2026-10-21）

已提供 [项目接收端模板](project-receivers.md)：Codex / Claude 两个启动入口、共享预检、
项目专用 CCIM_HOME 与身份清理、动态代理和接收/exec 分工。默认仅预检，实际启动需 `--start`。
本机 help/version 已核对；新增5项离线测试通过，语法与变更范围扫描通过。
此前154项完整测试与三个 dry-run 复用既有证据，本轮未重复执行或声称已上线。

限定目录没有找到原操作步骤 v2；以 #79 已提供文字准备，未声称逐项执行未知原文。
目标项目原 AGENTS.md / CLAUDE.md 不存在；同文建议、创建补丁、预条件和逐文件审批计划
仅存本机忽略的 artifacts，离线 patch check 通过，没有应用到项目。
未安装新项目运行文件、创建 CCIM_HOME、修改真实 Claude hooks、创建/加入成员、
生成/导出/写入秘密、启动新客户端、自动确认信任、发送消息或推送。

父接收会话报告：20:38 原工作站监听 end/start 成功，status running、who online；
本执行会话未复测，未发测试消息，Mac 重启未验证。此前回报 #80 已发送一次但为 offline queued，
不能当成已读证据，本轮不重发。工作站运行脚本哈希保持不变。

## 多项目验收记录（本地完成，外部验收待执行，2026-10-21）

本轮对应消息任务 #74；基线 `8eb9b70`，分支 `feat/multi-project`。
采用方案乙：新消息 `grok_send` 必须带 `"hop": 0`，缺省返回 `invalid_hop`。
工作站无需重新部署。已实现配置白名单/描述、成员参数、MCP env-name 参数、动态代理 helper 与接收包装模板。

| 测试 | 原有 | 新增 | 结果 |
| --- | ---: | ---: | --- |
| adapter | 69 | 5 | 74/74 通过 |
| scripts/test | 14 | 9 | 23/23 通过 |
| relay | 57 | 0 | 57/57 通过 |
| 合计 | 140 | 14 | 154/154 通过 |

原有测试文件与断言未修改。测试保留去重、自回拒绝、uncertain 退避、旧额度无效、
高 hop 和同窗口重复发送回归。另有本地接收包装 VM 验证通过，未真正调用 hook。
relay 在无秘密临时副本运行：首次因历史迁移测试找不到 Git 元数据失败；补充只读 Git 历史入口后
全套 57 项通过，未改变产品代码或断言。

三个 dry-run 均退出 0：relay 58.35 KiB（gzip 16.38 KiB）；默认 adapter 和新项目 adapter
均为 44.56 KiB（gzip 13.01 KiB）。使用已跟踪文件临时副本、已有依赖、隔离 HOME/XDG，
不加载机器私有配置或认证变量。relay 绑定 `CHANNEL (Channel)` / `AUTH (Auth)`，adapter 绑定 `ADAPTER (Adapter)`；
新项目 cron、migrations 保留，白名单 `codex,claude`。没有登录、上传或部署。
本机新项目配置被现有 `wrangler.*.local.toml` 规则忽略，仅含占位 relay URL 与 namespace，
实际部署仍需操作者填写。

接收包装脚本先备份，再最小加入动态代理环境。Node 24.16.0 与系统代理读取检查通过，
原身份和运行时保留；不修改系统代理、launchd、全局配置、Claude 设置。
收尾修正：helper 从仓库唯一维护源复制到固定接收目录的 `ccim-macos-proxy.cjs`，
包装脚本改用相邻运行副本。复制前后 SHA-256 一致，语法与隔离 fixture 检查通过；
启动不再依赖开发 checkout。helper 逻辑未变，复用上述完整测试和 dry-run 证据，未重复执行全套。
未重启原监听、未调用真实 who、未验证排队投递；这些由原接收会话执行，见
[恢复步骤](multi-project.md#codex-接收代理与原会话恢复)。不将代理支持差异认定为旧监听退出的根因。

**仍待外部验收**：push / merge、频道及成员准备、秘密配置、正式部署、实际 MCP 地址、
cron 运行、至少间隔一分钟两次只读检查、真实 Grok 多轮任务与产出、频道隔离、接收端重启。
本轮没有向其他会话发送消息。上游 PR #5 仅只读核对，见 [同步计划](upstream-sync.md)。
上述项目完成后再追加真实验收证据，不把准备或 dry-run 标记为上线。

日期：2026-10-21。范围：公开仓库代码、占位配置、本地测试、打包与操作文档。
本轮未部署、未调用运行中的 relay/adapter、未加入频道、未接管任何成员。

## 12 项交付映射

| 项 | 位置 | 本轮结果 |
| --- | --- | --- |
| 1 | [adapter](../../adapter/)、[MCP](../../adapter/src/mcp.js)、[发送](../../adapter/src/sends.js) | 从实际独立 adapter 当前文件导入；五工具、鉴权、唤醒、发送保护保留 |
| 2 | [loop-guard.js](../../relay/src/loop-guard.js)、[配置测试](../../relay/test/loop-guard-config.test.js)、[集成测试](../../relay/test/loop-guard.test.js) | 已检查并纳入上游 e584216；默认256、0关闭、非法值回落256 |
| 3 | [relay 配置](../../relay/wrangler.toml)、[adapter 配置](../../adapter/wrangler.toml) | 名称/域名/OAuth 绑定占位化；实际配置复制到忽略的 local 文件 |
| 4 | [CLI](../../plugin/bin/ccim)、[skill](../../plugin/skills/ccim/SKILL.md)、[README](../../README.md)、[NOTICE](../../NOTICE.md) | 无公共 relay 默认；安装源为 ginkoten/ccim；保留上游署名/历史 |
| 5 | [relay secrets 示例](../../relay/.dev.vars.example)、[adapter secrets 示例](../../adapter/.dev.vars.example) | 只有明显占位值；真实文件被忽略 |
| 6 | [rebuild](rebuild.md)、[provision-grok](../../scripts/provision-grok.mjs) | 按 relay → 频道/成员 → adapter → 客户端 → 验收排序 |
| 7 | [clients](clients.md) | 生命周期、hooks、信任、Bearer/Webhook 映射与提示词；Grok 新账号能力待核实 |
| 8 | [rotation](rotation.md) | 分电脑/账号/凭据迁移；说明无原地频道 secret 轮换接口与同名接管影响 |
| 9 | [verify](verify.md) | 三对来回、四阶段证据、grok_send 幂等/uncertain；历史 #43/#44 非本次实测 |
| 10 | [troubleshooting](troubleshooting.md) | 队列、409/429、认证、网络、403证据边界、relay 编号作用域 |
| 11 | [policy](policy.md) | 密钥、人类授权、白名单、hop 追溯、幂等与不确定处理 |
| 12 | [architecture](architecture.md) | Mermaid：三客户端、relay、adapter、例程，认证与数据范围 |

## 实际执行的验证

- Node 24.16.0，项目本地 Wrangler 4.151.2；复用已存在的本地依赖，不做全局安装。
- relay `npm test`：**57/57 通过**，包含 OAuth/原有协议/监听、持久存储升级、默认256、自定义1、关闭、幂等及真人输入重置。
- adapter：**69/69 通过**。实际来源的67项，加上当前 relay 缺失/查询失败时不发送且保留作用域证据的2项回归。
- CLI/provisioning：**4/4 通过**。无默认公网目标、配置优先级、guarded join、私有文件、无凭据回显、失败保留原会话、不覆盖/重试 token 文件。
- 合计 **130 项通过**；测试仅访问本地 Worker 或 mock，不构成线上往返验收。
- 两个锁文件在临时空目录执行 `npm ci --dry-run --ignore-scripts --offline --no-audit --no-fund` 均通过，没有安装依赖。新机下载/安装仍需按 rebuild 执行。
- relay placeholder dry-run：成功，58.35 KiB / gzip 16.38 KiB。
- adapter placeholder dry-run：成功，45.76 KiB / gzip 13.33 KiB。
- 旧迁移测试带历史 routes；已从临时配置移除。测试环境设 NODE_ENV=test，避免 Miniflare 启动时获取外部 Request.cf 元数据造成等待；保留原有迁移断言。

## 安全扫描与来源保护

扫描当前文件及可达 Git 历史，使用已知本机凭据的内存匹配和高置信凭据/个人路径/运行配置模式；报告不含匹配值。
本轮待提交内容没有命中真实凭据、个人绝对路径或实际运行配置。忽略检查通过：两个包的 `.dev.vars`、`wrangler.local.toml` 和 `node_modules`。

上游已公开历史有运行域名/绑定示例，位置为：`README.md`、`docs/usage.md`、
`docs/mcp-oauth-design.md`、`docs/mcp-oauth-rollout.md`、`relay/wrangler.toml`、
`relay/test/deploy.test.js`、`relay/test/flow.test.js`、`relay/test/policy.test.js`。
这些当前文件已去个人化；未改写上游历史。历史扫描没有命中已知私有凭据或高置信 token 模式。
模式扫描不能证明未知格式密钥绝对不存在；测试中的合成凭据、lockfile integrity 哈希不作为真实密钥。

从公开 main 建独立工作目录，不推送本机候选 self-hosted 分支的历史。
原独立 adapter 的15个 src/test 文件哈希核对未变；原有 package/lockfile、Webhook 辅助脚本及其他未提交修改留在原处。
较旧 fork 仅作来源比较，没有作为最新代码覆盖依据。
上游所检版本未发现 LICENSE 文件，未虚构许可证；见 NOTICE。

## 未完成的真实环境验收

- 新电脑从零安装和真实 Cloudflare 账号登录/部署/cron。
- 新 Codex/Claude 账号的交互式接收会话、hooks 信任和监听生命周期。
- 新 Grok 账号的例程 UI/权限、Webhook 真正启动、五工具实际调用，尤其 grok_send。
- Codex↔Claude、Codex↔Grok、Claude↔Grok 三对实际四阶段来回。
- 历史 #8/#12 的原始500堆栈归因，以及 #43/#44 历史回报的重新验证。

当前任务 chat 没有匹配的本地 ccim 身份记录，因此不冒用其他接收 chat 发送验收通知；由用户复制交付通知给 Grok。

## Grok 复核后的补充（2026-10-21）

Ginko 转达 Grok 对 `43dca17` 的复核：原130项测试、两个 dry-run 通过，
gitleaks 全历史仅命中3处测试假值。这里记录为对方回报，不冒充本轮执行的 gitleaks 结果。

本轮补齐：

- `clients.md`：Claude 的环境代理/Node版本要求；Grok Webhook例程创建、字段取值、安全变量和MCP检查命令。
- `rebuild.md`：客户端也要Node22+；workers.dev首次配置、部署URL位置、私密导出和cron观察步骤。
- `scripts/check-adapter-mcp.mjs`：Bearer只从环境读取，四步只读诊断；不发送、ack或打印原始响应，失败不重试。
- `scripts/export-channel-secret.mjs`：从CCIM_HOME导出选定频道secret为新0600文件，不回显、不覆盖文件或目标软链接。
- `plugin/bin/ccim`：帮助改为--secret-file，delete实现同一私密文件参数；保留旧参数兼容但不再推荐。

实际重新执行 adapter 69项 + 脚本12项 = **81项通过**。新增8项覆盖只读MCP兼容、错误/凭据不泄露、
禁止不安全URL、secret导出权限/覆盖保护、CLI帮助与delete私密文件输入。
relay源码与Worker配置未改；原57项和两个dry-run沿用上次证据，没有把未重跑项目计入本轮81项。
本轮未安装、未部署、未调用真实adapter或例程。文档相对链接、diff检查和当前文件/历史凭据扫描通过；
本机无gitleaks，未安装或声称再次执行。客户端产品步骤引用官方文档，真实新账号验收仍待完成。

## 取消 adapter 自设额度（2026-10-21）

按 Ginko 的直接授权移除两跳上限、主动发送频率/每日额度及唤醒频率/每日额度。
hop/source_message_id 留作追溯；无替代的任务条数额度。保留鉴权、白名单、自回拒绝、
成功后不重复唤醒、clientId/part 幂等、uncertain 锁与 Webhook 失败退避。
旧环境额度被忽略；旧 hop_limit 消息仅在仍处于当前中继队列时恢复分类，不清空已读/唤醒/发送记录。

本次本地结果：relay 57、adapter 69、脚本14，共 **140项通过**。
adapter 占位配置 dry-run 通过（43.77 KiB / gzip 12.80 KiB），未上传。
回归覆盖高 hop、同窗口110次发送、35次新消息唤醒、旧存储恢复、原有500/uncertain与鉴权路径。
这些批量测试只运行于假中继，不是生产压力测试。

原专用接收 chat 经单独授权恢复了自身监听，已核验其自动入站记录包含待查的 Grok #68
（同批另有 #69），不是以“队列为空”代替接收证据；未补发消息或重新加入频道。
直接网络探测超时，采用系统现有代理的进程可取得 HTTP 响应；旧监听退出原因仍未证实。
恢复接收不代表新的 adapter 代码已上线。生产部署与真实 Grok 高 hop 调用验收另行记录。

### 生产部署确认（2026-10-21）

用户确认后，已将 `391b82e` 的 adapter 源码部署至既有 Worker，保持 Worker 身份、Durable Object 与 STATE_NAMESPACE。没有修改密钥、创建成员或发送测试消息。

只读验收：五个 MCP 工具可发现；grok_send 的 hop schema 不再包含 maximum；grok_status 的 hop_limit、sender_limit、daily_cap、send_limit、send_daily_cap 均为 null；无 Bearer 请求仍返回401。部署后的 cron 已成功轮询。部署前后最近20条消息的阶段/回复记录一致，既有每日唤醒计数未重置。

`/health` 返回200；项目没有 `/status` 路由，仍返回404及 not_found，业务状态通过 MCP grok_status 查询。上述结果证明版本生效与状态连续性，不冒充真实 Grok 高 hop 发送的端到端验收。
## 多项目上线执行记录（部分完成，2026-10-21）

本轮已有 Ginko 对安装、规则、频道/成员、四项秘密、推送合并和部署的直接授权；不再等待重复授权。
记录对应 #74（GinkoAI 独立桥频道）、#79（接收端隔离与令牌保存）和 #81（编号附简短说明）。

- 已安装独立接收目录、CCIM_HOME、四个运行文件和两份非秘密启动配置；Codex/Claude 预检通过。
- 两项目 AGENTS.md / CLAUDE.md 的编号说明规则已同步；工作站仅增加该条，未处理业务资料。
- Claude 缓存中的四个 ccim hooks 已有代理开关，核对后未改；原工作站监听进程未操作。
- Codex 新客户端启动到四个 hooks 的信任提示，未自动接受。Claude 新客户端启动后返回 API 401，未改变认证或切换账号。
- 专用 MCP_BEARER 已生成、私密保存并通过 stdin 写入指定 Worker；只读 secret 清单确认该名称存在。
  首次写入创建了占位 Worker；这不代表 adapter 正式部署或 MCP 可用。
- GinkoAI Webhook URL/key 未在本轮指定环境和项目私有文件中找到。没有复用工作站 Webhook，也没有读取 Cloudflare 不可导出的秘密。
- 频道/成员尚未创建；codex/claude 等待各自真实接收会话首次 join，grok provision 等待频道存在。
  未导出客户端 token、未读取内部会话存储，未生成游离 codex/claude token。
- Git push 遇到 GitHub 443 TLS 中断，没有重复推送、强推、创建 PR 或更新远端 main。
- 上游 PR #5（通用 adapter）head 仍为 `d16571b`；保留逐项同步计划，未整批移植或覆盖其默认策略。

本轮只增加文档，复用此前 154 项和新增 5 项离线测试、三个 dry-run 证据。
正式 adapter 部署、cron、间隔至少一分钟的两次 MCP 检查、poll.at 推进及真实消息隔离验收均未完成。
当前接口提供 poll.at 时间戳，没有累计 poll 计数；不能把 wakes_today 作为轮询次数。
本执行会话未发送桥回报，统一由父接收会话交付；本机无秘密的执行报告保存在忽略的 artifacts 中。
