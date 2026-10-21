# 重建项目验收记录

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
