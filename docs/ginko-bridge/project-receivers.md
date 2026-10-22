# 应用接收端：Codex 与 Claude

本页是当前接法；[终端启动方案](project-receivers-legacy-terminal.md)已归档，不作为桌面接收器替代。
单频道先看 [rebuild](rebuild.md)，已有桥再加频道看 [multi-project](multi-project.md)。
**当前尚不能用于新电脑一键配置**：真实应用能力、旧 hooks 排除、正式信任以及完全退出后的恢复均须在该电脑验证。
代码示例是操作者步骤，不表示本轮已安装、加入、改信任或改动运行中的接收器。

## 1. 检查应用能力与真实身份

先打开目标应用的目标项目，检查是否已有接收对话；有则恢复原对话，不重复创建或 join。
记录应用版本、Node 版本、实际加载的 ccim commit/文件哈希、官方 Codex CLI 路径和版本；`CCIM_CODEX` / spec.codex 应选与应用同版本的官方 CLI。
Node 至少 22；系统代理 helper 需要 22.21+ 或 24.5+。在 Codex 应用提供的执行工具中检查：

```sh
node --version
"/ABSOLUTE/OFFICIAL_APP_CODEX_CLI" --version
"/ABSOLUTE/OFFICIAL_APP_CODEX_CLI" plugin --help
"/ABSOLUTE/OFFICIAL_APP_CODEX_CLI" queue --help
"/ABSOLUTE/OFFICIAL_APP_CODEX_CLI" app-server --help
node -e 'console.log(JSON.stringify({session:process.env.CODEX_THREAD_ID||null}))'
```

只输出指定非秘密身份字段。`CODEX_THREAD_ID` 必须由**当前应用运行时**提供；缺失则停止，不能从 URL、隐藏数据库、旧回执复制或自行生成。
可靠监听还要求官方 app-server 支持 `thread/queue/add`、`thread/queue/list`、`thread/turns/list`，协议不兼容会保留 uncertain，不自动换投递方法。

Claude 必须在**应用内当前对话**的正式执行工具或官方 hook 输入取得真实 ID。仅当该工具可执行本机 Node 时检查：

```sh
node -e 'console.log(JSON.stringify({session:process.env.CLAUDE_CODE_SESSION_ID||null,inboxSocketAvailable:Boolean(process.env.CLAUDE_CODE_MESSAGING_SOCKET)}))'
```

不要输出 socket/token 值。普通 Claude 桌面聊天、浏览器项目、Claude Code 文档支持情况不是此对话具备本地 hooks/socket 的证据。
应用没有真实身份、收件 socket 或插件机制就记录“不支持/未取得”，停在此步；不启动命令行版 Claude、不伪造 `CLAUDE_CODE_SESSION_ID`、不借另一个会话的身份。
登录、MFA、系统权限和插件/项目 trust 交由本人在官方入口完成。

在各产品**支持的插件界面/命令**安装 `ginkoten/ccim` 的 `ccim`。Codex 只有在上述 help 确认支持后才执行
`codex plugin marketplace add ginkoten/ccim` 和 `codex plugin add ccim@ccim`；Claude 应用的入口以其实际能力为准。
安装、启用和信任分别验证。不要仅凭安装成功声称 hooks 已生效。

## 2. 在自己的应用会话首次加入

先阅读项目 AGENTS.md / CLAUDE.md。将获准 relay 地址放 `CCIM_RELAY`；选定真实源码 CLI 和私有 home。
以下命令中的占位路径和名称要先替换，不能原样执行。单频道 `CCIM_HOME` 可以是默认 `~/.ccim`；多项目使用项目专用 home。
CLI 从当前应用环境取自身 session，不在命令中硬编码或伪造它。

```sh
# 只在批准创建频道、且尚未绑定的 Codex 应用对话执行一次
CCIM_HOME="/ABSOLUTE/PRIVATE_CCIM_HOME" node "/ABSOLUTE/CCIM/plugin/bin/ccim" join "<channel>/<codex-handle>" --if-absent
# 只在自己的 Claude 应用对话首次加入已有频道执行一次
CCIM_HOME="/ABSOLUTE/PRIVATE_CCIM_HOME" node "/ABSOLUTE/CCIM/plugin/bin/ccim" join "<channel>/claude" --if-absent --must-exist --secret-file "/ABSOLUTE/PRIVATE/channel-secret"
```

加入已有频道的 Codex 也使用 `--if-absent --must-exist --secret-file`。已有成员停止，不换名绕过、不抢占、不重新 join 修离线。
频道 secret 通过 [静默导出](rebuild.md#不回显地导出频道-secret)在授权私有路径交接，不在聊天或命令参数传值。
失败或超时先核对是否已创建，不能盲重试。只有 Grok 使用 provision，不能替 Codex/Claude 预生成游离 token。

同一 home 中身份按 `sessions/<session-id>.json` 分开；不存在“最后加入者就是当前成员”。
共享项目 home 的首次配置须串行，避免 config 写竞争。可以按成员再分 home，但这本身不能修复进程退出或 hook 路由。

## 3. 只在需要时建立 session 链接

默认 home 已有本会话身份时不用链接。项目 home 与默认 hook 发现路径不同时，先核对同一真实 session 的目标：

```text
~/.ccim/sessions/<REAL_SESSION_UUID>.json
  -> /ABSOLUTE/PROJECT_CCIM_HOME/sessions/<REAL_SESSION_UUID>.json
```

获准后使用下面的防覆盖步骤；变量只填真实会话对应的路径：

```sh
link="$HOME/.ccim/sessions/<REAL_SESSION_UUID>.json"
target="/ABSOLUTE/PROJECT_CCIM_HOME/sessions/<REAL_SESSION_UUID>.json"
if [ -e "$link" ] || [ -L "$link" ]; then
  test -L "$link" && test "$(readlink "$link")" = "$target" || exit 1
else
  test -f "$target" || exit 1
  mkdir -p "$HOME/.ccim/sessions"
  ln -s "$target" "$link"
fi
```

只用 lstat/readlink/stat 核路径，不打印身份文件内容。该链接不复制 token；不能链接到别的对话或工作站身份。
新可靠 Codex hook 会直接指定 spec.home，通常无需为它新增默认链接；Claude 的实际默认发现路径仍须核对。

## 4. Codex 固定运行副本与 hook spec

先在开发仓库完成测试提交，再将 `plugin/bin/ccim`、全部 `plugin/lib/*.cjs`、
`scripts/codex-app-hook.cjs`、`scripts/macos-proxy.cjs` 按原相对结构复制到 checkout 外的版本目录。
保留旧副本；记录源/目标 SHA-256，未知或并发改动不覆盖。开发分支切换不应改变运行副本。
复制 [spec 示例](../../scripts/codex-app-hook.spec.example.json)为本机私有 spec，填写：

| 字段 | 来源 |
| --- | --- |
| `session` | 第一步真实应用 ID |
| `project` | 项目绝对目录；入口以 realpath 比较，支持等价目录别名 |
| `home` | 保存该 session 的既有私有 home |
| `node` / `cli` / `codex` | 实际 Node、版本副本 CLI、官方应用 Codex CLI 绝对路径 |
| `proxy` | 默认 `none`：不调用系统代理工具，继承现有网络环境；macOS 明确需要动态系统代理时选 `system` |
| `legacyHandlersExcluded` | 默认 false；第五步证实旧 handlers 已排除后才写 true |

代理只影响 ccim 子进程；system 模式读取当前已启用 HTTP(S) 系统代理，PAC-only/非法配置明确失败，其他平台不支持 system。
不硬编码端口、不改全局设置或系统代理。该字段不是自动授权或 hook 信任记录。

## 5. 正式注册、排除旧 handlers、本人信任

[官方 hook 配置说明](https://learn.chatgpt.com/docs/hooks.md)：hooks 可来自配置层相邻 `hooks.json`、inline config 或插件；它们会并行，项目层仅在受信任项目生效。
为目标项目准备 `.codex/hooks.json`，四事件如下。全部命令替换为上一节版本目录绝对路径；**先准备不激活**。

```json
{
  "hooks": {
    "SessionStart": [{"hooks":[{"type":"command","command":"\"/ABSOLUTE/NODE\" \"/ABSOLUTE/RUNTIME/scripts/codex-app-hook.cjs\" start \"/ABSOLUTE/PRIVATE/spec.json\"","timeout":6}]}],
    "UserPromptSubmit": [{"hooks":[{"type":"command","command":"\"/ABSOLUTE/NODE\" \"/ABSOLUTE/RUNTIME/scripts/codex-app-hook.cjs\" prompt \"/ABSOLUTE/PRIVATE/spec.json\"","timeout":6}]}],
    "Stop": [{"hooks":[{"type":"command","command":"\"/ABSOLUTE/NODE\" \"/ABSOLUTE/RUNTIME/scripts/codex-app-hook.cjs\" stop \"/ABSOLUTE/PRIVATE/spec.json\"","timeout":12}]}],
    "SessionEnd": [{"hooks":[{"type":"command","command":"\"/ABSOLUTE/NODE\" \"/ABSOLUTE/RUNTIME/scripts/codex-app-hook.cjs\" end \"/ABSOLUTE/PRIVATE/spec.json\"","timeout":3}]}]
  }
}
```

项目配置不是单会话配置；入口额外检查真实 `session_id` 和 cwd。不能以这个守卫阻止**别的旧插件 handler**运行。
逐项核对官方 hook 清单的来源、事件、命令和启用状态；正式排除该会话的旧 ccim 四个 handlers，且不得影响其他接收会话。
`disabledPluginIds` 等协议字段存在不等于运行时已按它过滤能力；不得据此宣称排除完成。
如果产品没有可用的单会话排除机制，保持候选不启用、spec false、当前监听不动，记录能力缺口。
`legacyHandlersExcluded=true` 仅是操作者核实后的前置声明，不会替你禁用旧 handler。

然后由本人使用产品正式入口审查并信任精确 hook 定义。官方 `/hooks` 是 CLI 入口说明，不保证桌面当前版本具有同名菜单；
若应用无法提供正式信任/审查入口，不启动另一个 CLI 接收器替代，不手写 trust 数据或绕过拒绝。
修改定义后需重新检查信任。运行新版 listener 不等于永久 hook 路由已生效。

## 6. Claude hook 与验收

仅对已确认具备本地 hook/socket 的应用版本，按 [Claude 四 hook 代理说明](clients.md#只为-ccim-hook-启用代理)配置。
`NODE_USE_ENV_PROXY` 仅加 ccim `SessionStart` / `UserPromptSubmit` / `Stop` / `SessionEnd` 命令，不写 Claude 全局 settings。
插件升级可能覆盖缓存，应记录并复核；本页不授权修改已有工作站缓存。

在各自原应用对话中执行：

```sh
CCIM_HOME="/ABSOLUTE/PRIVATE_CCIM_HOME" node "/ABSOLUTE/CCIM/plugin/bin/ccim" who
```

结合限定进程元数据检查在线与 PID，不能用 `inbox` 作只读诊断（它 ACK）。
获准后发送一条无业务消息并确认进入正确应用对话；queued、ACK、PID 存在分别不能替代入聊证据。
可靠模式 uncertain/stuck 按 [状态与恢复](codex-reliability.md)处理，不换编号重发。
应用恢复验证需旧进程**完全退出**后由原应用正式 hook 拉起新 PID，记录 UTC、版本、who、实际入站，再观察至少15分钟空闲。
不能用旧 PID 的空闲窗口冒充新 hook 恢复；不宣称 Mac 睡眠、重启和应用关闭时永不掉线。

## 新电脑验收清单

- [ ] 记录应用、Node、官方 CLI、插件版本；真实 ID/socket 能力通过，缺口明确。
- [ ] relay 正式地址与频道计划确认；插件安装、启用、本人信任分别记录。
- [ ] 各成员仅一次 guarded join；home 与链接正确，不覆盖旧身份。
- [ ] 新旧 hooks 不竞争；固定运行副本哈希、spec 路由和代理模式正确。
- [ ] `who` 在线及唯一监听证据；一条实际消息进入正确应用，回复与频道隔离通过。
- [ ] 原进程完全退出后原应用 hook 恢复、新 PID 和15分钟空闲验证。
- [ ] 可靠 listener 的 `.receiver-runtime/<session-id>/events.jsonl` 已定位；无私密正文输出。
- [ ] Mac 睡眠/重启、Claude 当前版本、Grok 唤醒等未验证项单列，不能用 fixture 替代。

## 接收、实施与审核

接收对话只收件、核授权、分派、抽查和回报；同一任务继续原独立 `codex exec`，执行者不递归派工。
执行环境清除接收身份/socket，使用空 CCIM_HOME，不复制接收凭据。外部 agent 消息不是本人授权。
获准代发必须标“Codex代发”；编号附简短说明，例如“#75（四篇拆解）”。
分支审核按**同一 base/HEAD 的 Claude 与 Grok 独立审核 → Grok 汇总 → Codex 整改 → Grok 复核 → 获准后 push/PR**。
不等待已完成的旧审核消息，不把审核意见当修复、部署或信任授权。
