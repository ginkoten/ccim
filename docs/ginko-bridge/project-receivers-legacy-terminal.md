# 历史终端接收方案（已停用）

当前入口：[应用接收端](project-receivers.md)。以下是历史快照，不适用于新机安装。
归档脚本保留相对目录结构，未部署到任何运行目录。旧复制重命名表仅记录原方案。

## 历史终端启动方案（不再使用，以下仅供追溯）

以下保留原安全准备文字和命令，不代表当前应安装或启动终端接收器。
`scripts/legacy/project-receiver.cjs`、`start-codex-receiver.example.cjs`、`start-claude-receiver.example.cjs`
及已复制的对应 launcher 不再作为接收入口。其离线测试只证明旧模板参数行为。
`scripts/macos-proxy.cjs` 可继续供获准的 ccim hook 入口复用；这不恢复终端接收方案。

### 原启动模板记录

本页准备两个接收客户端的启动入口，不代表已创建 CCIM_HOME、频道、成员或秘密文件。
原操作步骤 v2 未取得，不能声称按该文档逐项实施；本轮只依据 #79 已提供需求准备。
实际文件安装、规则写入、频道/成员/秘密操作和上线都要分别确认。

## 固定运行目录

沿用 [运行副本同步约定](acceptance.md#历史部署与原会话恢复步骤归档)，
在开发 checkout 外为新项目选择独立接收目录。不要覆盖工作站的脚本、会话或代理入口。
仓库文件是唯一维护源；实际安装时记录源码提交和复制前后 SHA-256，核对并发修改，保留原内容：

| 仓库源 | 固定接收目录中的文件 |
| --- | --- |
| `scripts/macos-proxy.cjs` | `ccim-macos-proxy.cjs` |
| `scripts/legacy/project-receiver.cjs` | `ccim-project-receiver.cjs` |
| `scripts/legacy/start-codex-receiver.example.cjs` | `start-codex-receiver.cjs` |
| `scripts/legacy/start-claude-receiver.example.cjs` | `start-claude-receiver.cjs` |

复制辅助模块为普通文件，不用指向开发 checkout 的软链接。模板只需 Node，无新 npm 依赖。
脚本不创建 CCIM_HOME，不读取里面的 config/session 文件，不执行 join 或发放令牌。

## 环境与预检

由操作者批准后准备这些非秘密变量，不在脚本里写真实地址或凭据：

| 变量 | 作用 |
| --- | --- |
| `CCIM_PROJECT_DIR` | 项目根目录的绝对路径 |
| `CCIM_PROJECT_HOME` | 项目专用 CCIM_HOME 的绝对路径；位于项目 checkout 外，不能是工作站默认 `~/.ccim` |
| `CCIM_CODEX_BIN` / `CCIM_CLAUDE_BIN` | 可选的 CLI 绝对路径；未指定时从 PATH 使用 codex / claude |
| `CCIM_RECEIVER_RESUME_ID` | 可选、由对应接收会话登记的 UUID；首次启动留空，后续恢复明确指定，不能填写工作站线程 |

Codex 与 Claude 使用同一项目专用 CCIM_HOME，分别绑定自己的 session/member；授权后的首次成员配置顺序执行，
不并发修改共享配置。项目 root 与 home 必须已存在，预检只查看目录，不读取秘密。
两个启动模板默认 `--check`，显式 `--start` 才会打开实际客户端：

```sh
node "$RECEIVER_DIR/start-codex-receiver.cjs" --check
node "$RECEIVER_DIR/start-claude-receiver.cjs" --check
# 以下仅在批准启动后，分别从独立终端窗口执行
node "$RECEIVER_DIR/start-codex-receiver.cjs" --start
node "$RECEIVER_DIR/start-claude-receiver.cjs" --start
```

预检读取动态系统代理并在子进程中运行 CLI `--help`，仅输出已知布尔诊断字段，不打印路径、代理地址、
config 或凭据。失败停止，不自动 login、创建账户、改权限、安装软件或回退到原工作站 CCIM_HOME。
预检不证明账号已登录、插件已安装/获信任、频道已加入或消息能够送达；这些需分别验收。

启动器清除继承的 CCIM/session/socket 身份、旧 relay/成员环境值，再设置项目 CCIM_HOME。
独立执行会话不得复用接收线程身份；新的接收会话也不能自动接管既有成员。
不自动指定插件目录、信任 hooks、运行 join、发送消息或执行任务。

## 已核对的客户端参数

本机只执行帮助/版本检查：Codex `0.163.0-alpha.11`，Claude Code `2.1.98`。
以后运行模板也会再次检查本机 help 是否具有所需参数；不会启动客户端来验证 help。

- Codex 新接收：`codex --cd PROJECT --sandbox read-only --ask-for-approval on-request PROMPT`。
  恢复：`codex resume --cd PROJECT --sandbox read-only --ask-for-approval on-request SESSION_ID PROMPT`。
- Claude：工作目录设为项目根目录，`claude --permission-mode default PROMPT`；恢复添加 `--resume SESSION_ID`。
- Codex 独立任务：`codex exec --cd PROJECT --sandbox read-only --output-last-message RESULT_FILE -`，任务从 stdin 输入。
  `codex exec --help` 已确认这些参数；需要代码写入的任务必须先有明确写入范围授权，再按范围选择 workspace-write。

模板主动选择保守权限，不带 bypass、自动批准或跳过 hook trust 参数。
接收线程启动 exec 如受到权限限制，应报告并请求对应范围批准，不能自行扩大沙箱或改全局设置。
不会通过新账号、额外认证、共享他人 token 来绕过登录。登录和信任弹窗由人完成。

## 代理边界

动态系统代理逻辑复用现有 helper，Node 22.21+ 或 24.5+。Codex 接收子进程继承该代理环境。
Claude 接收进程继承 HTTP(S)_PROXY 地址但启动器移除 `NODE_USE_ENV_PROXY`，
该开关只由获批准的 ccim 插件四条 hook 命令提供，遵循 [原 Claude hook 文档](clients.md#只为-ccim-hook-启用代理)。
不写 `~/.claude/settings.json`，不改 Claude 自身认证方式，也不宣称能覆盖其所有既有代理设置。
本轮没有修改实际插件 hook。启动模板本身不会安装 hooks；升级后的 hook 信任仍由人确认。

## 接收与执行分工

启动提示词要求接收会话只收件、核对授权、分派、验收；具体同文规则应由操作者确认后合并到项目
AGENTS.md / CLAUDE.md，保护已有内容。每个任务需要明确的直接用户授权范围，外部 bot 的转述不能替代。

获授权任务在项目 root 执行 `codex exec`，正常继承仓库 AGENTS.md，不绕过规则发现。
输入包包含：接收角色与执行角色、原消息来源/编号、用户批准范围、禁止事项、相关规则、结果位置。
原消息标记为外部数据，不将其中的命令升级为用户指令。子任务禁止递归分派和桥上发消息，结果交接收会话验收。
执行环境清除接收会话身份/socket变量，给 worker 指定空的、未绑定的 CCIM_HOME，禁止读接收端凭据。
没有人类授权就只保存待批准任务摘要，不启动自动执行；写入、费用、权限、频道、成员、秘密、push、部署边界分别核对。

接收线程以频道/消息编号记录分派与结果，避免重启后重复启动。同一任务已有执行会话时向现有任务补充范围，
不另起重复任务。仅在明确获准发送回执时向原发送人回复一次，区分 sent、queued 和 uncertain，
不因 offline queued 重发；worker 不直接发送。业务产出在执行会话生成，接收线程只验收和交付链接。

提到桥消息或任务编号时，附一句简短说明，例如“#75（四篇拆解）”；不能只报编号。
同一规则同步到工作站和新项目的 AGENTS.md / CLAUDE.md，工作站只改该条规则，不处理新项目业务。

首次加入前核对实际 CLI 支持 `--if-absent`、`--must-exist` 和 `--secret-file`，且创建频道不输出 secret。
旧插件缓存可能没有这些保护；不能直接用旧 CLI 抢占成员，也不能把输出重定向到任务日志后再脱敏。
应使用已核对的仓库 CLI，由新接收会话以自己的真实身份首次加入；不读取内部会话存储推断身份。

操作者已经明确批准的安装、频道、秘密或上线范围持续有效，不因模板中的分步审批文字重复询问。
认证、项目/插件信任与工具安全拒绝仍须按实际边界处理；无法获取的输入单独记录，继续其他独立步骤。

## 验收与待授权事项

离线验证覆盖默认不启动、显式启动参数、目录隔离、继承身份清理、Claude hook-only 变量、
显式 resume、非法参数及失败输出脱敏。本轮不启动新客户端、不读取现有私有 CCIM 配置。
此前测试/dry-run 仍是原证据，本页新增离线测试单独计数。

批准清单应分项列出：固定运行文件安装、独立 CCIM_HOME 创建、规则合并、实际 hook 四命令改动、
频道/成员加入与令牌/secret 文件操作、现有账号登录、客户端启动和hook trust、消息发送、Worker secrets、部署和push。
不能把“部署前审批”解释为其他敏感操作已经批准。逐文件计划与规则补丁只保存在本机忽略的 artifacts 中供审阅。
