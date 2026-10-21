# 上游 PR #5 同步计划（未执行）

2026-10-21 通过 GitHub API 只读核对 [web3nomad/ccim PR #5](https://github.com/web3nomad/ccim/pull/5)，
并 fetch PR head 到 `FETCH_HEAD` 供本地比较，没有切换、修改或推送 PR 分支。

- PR 状态：open；base `e58421663cebd3d73613f02204fb36990caf512a`。
- head：`d16571b299204a54fdab2b74b333fc59fc737219`，fork 分支 `codex/grok-adapter-upstream`。
- 本次 fork 基线：`8eb9b70620a07a2bd687cc2cf464c1bf39b7c1b1`。
- PR 四个提交：`0c4f508` relay loop guard 配置、`ae6f6e6` adapter、
  `b80c478` 插件私密文件/诊断、`d16571b` 通用文档。

## 已核对差异

| 模块 | PR #5 当前行为 | fork 当前目标 | 同步处理 |
| --- | --- | --- | --- |
| relay/src | 与本任务开工基线完全相同 | 本任务不改 relay | 保留，不重复导入 |
| adapter 白名单 | `SEND_ALLOWED_RECIPIENTS`，未配置禁用主动发送 | `ALLOWED_RECIPIENTS`，空/无效时工作站默认白名单 | 两种默认策略冲突，不能盲目覆盖；上游需确认命名和默认行为 |
| adapter hop / quota | schema `maximum: 1`，运行时 hop ≥ 2 拒绝；发送/唤醒频率及每日额度仍在 | `6897f3a` 已去除额度，保留追溯、去重、自回拒绝、uncertain 保护 | 明确移植额度移除及回归测试，不能只更新白名单 |
| 成员脚本 | `provision-member.mjs CHANNEL HANDLE TOKEN_FILE` | `provision-grok.mjs CHANNEL TOKEN_FILE [HANDLE]`，HANDLE 默认 grok | 保留上游通用脚本名/参数顺序，迁移校验及保护测试；是否提供兼容入口单独确认 |
| MCP 检查脚本 | 与 fork 开工基线相同，无变量名参数 | 新增两个 env-name 参数 | 可移植该文件及相应新测试 |
| 接收端代理 | 无本次两个脚本及代理测试 | 动态读取系统代理，模板保持会话身份 | 可独立 cherry-pick 新文件提交，通用文档单独移植 |
| 插件 CLI | 已有抽取的 `secretFromArgs` 和公共默认 relay | fork 使用显式私有 relay，参数处理结构不同 | 不整体替换 plugin/bin/ccim，不把 fork 默认地址决策带进 PR |
| 文档 | 通用 `docs/grok-adapter.md` | `docs/ginko-bridge/` 与工作站验收 | 翻译为通用接入文档，不提交本机报告或声称上游已部署 |

## 建议提交安排

在 Ginko 确认后另建同步分支，基于当时重新核对的 PR head；本任务不执行 cherry-pick。

1. **额度移除**：以 `6897f3a` 为补丁来源，使用不自动提交的 cherry-pick 或逐文件移植。
   PR 已有 generic recipient 结构，预计 `util.js`、`mcp.js`、测试与 Wrangler 配置存在语义冲突；
   保留 PR 的泛化结构，把高 hop、同窗口多次发送、唤醒和旧状态恢复测试一起迁入。
2. **多项目配置**：以 `44acd3c` 为来源，移植按请求生成描述/枚举、自身排除及测试。
   先确认上游采用哪种 env 名与默认策略，再调整，不能直接覆盖上游 fail-closed 默认值。
3. **脚本参数**：以 `f85e1d6` 为来源。MCP 检查脚本可直接迁入；provision 文件名与参数顺序
   按上游接口适配，不引入重复且不兼容的 CLI。拆分 MCP 与 provision 两个可独立 review 的提交。
4. **代理模板**：`4c79ed3` 只新增 helper、包装模板、测试，可作为独立 cherry-pick 候选。
   在上游运行后确认路径、Node 版本与原有 hook 生命周期兼容。
5. **文档**：把本次多项目、方案乙、动态代理与部署审批内容整合进 `docs/grok-adapter.md` /
   `docs/usage.md`；只移植 `391b82e`、`8eb9b70` 中通用策略与 Claude hook 说明。
   不复制工作站部署记录、个人路径、真实地址、本机报告或 fork 品牌配置。

建议当前 PR #5 保留已经存在的 relay 部分，不重复拆写；额度移除、白名单和脚本作为清晰提交更新 adapter 部分。
macOS 接收代理可另开后续 PR，降低平台专属变更与 Worker 行为耦合。
若上游维护者要求 relay/adapter 分离，再拆 PR；本任务没有创建、修改或推送任何 PR。

同步后须重新跑 adapter、scripts、relay 测试和三个无秘密 dry-run，复查 fixture、秘密扫描及文档。
push、PR 更新和最终策略选择均等待 Ginko 确认。
