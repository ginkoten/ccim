# 重建 Ginko-Bridge

## 新电脑先分清首次安装与接替

本页是主入口，配合 [应用接收端](project-receivers.md) 使用应用内专用对话与 `~/.ccim/sessions` 的既有发现链接，不以终端接收器作为主路线。
首次全新频道才按下文 guarded 创建；换电脑接替已有频道不是首次创建。先恢复正式应用入口、核对旧接收者与未完成/uncertain 账本、单实例所有权和获准凭据交接，再按 [rotation](rotation.md) 操作。已有成员返回409或结果未知立即停下；离线不重 join，不借旧对话ID伪装新会话。

复制 `scripts/channel-layout.example.json` 到自己的未提交配置，仅填非秘密映射，用 `node scripts/check-channel-layout.mjs /path/layout.json` 离线检查。每频道列出 relay/channel、私有 CCIM_HOME、应用真实 session、默认发现链接、独立 adapter Worker、稳定 STATE_NAMESPACE、服务成员、允许收件人和安全变量名。示例 UUID/路径全部是占位符，不可用于实际绑定。
应用 hook 通常无需自建 TCP 端口，填 null；确有获准本地端口才登记并检查独占。脚本只检查声明，不读取会话文件或核实监听；运行时还要在本频道应用对话执行标准 who/status、核对 owner 与单实例，不杀其他项目进程。

两个频道不得混用 token、MCP Bearer 环境变量、session 链接、Worker 或存储标识；相同 relay 可以共用。此预检采用每频道独立 home 的保守配置，不支持把同一 home 的复杂共享布局自动判为安全。凭据只通过密码管理器/受控环境安全注入；不得把 session、私有配置、token 文件或线上导出包提交 Git。

离线复建演练：Node 24.5+，`node --test scripts/test/*.test.mjs`、adapter 和 relay 的 npm test。测试用临时目录/假凭据/本机 mock，不能证明新电脑应用能力或生产端到端已验收。故障证据与未确定触发事件见 [10月24日复盘](incident-20261024.md)。

从 `https://github.com/ginkoten/ccim` clone 完整历史；升级测试会读取历史提交。
部署机器需要 Node 24.5+、npm 和 Cloudflare 免费账号；**每台运行 ccim 的 Codex/Claude 客户端机器也需要 Node 24.5+**，
不能只在部署机器安装。运行 MCP 示例脚本的 Grok 执行环境也需 Node 24.5+。
本地验证使用 Node 24.16.0（要求24.5+）；依赖环境代理时另见 [clients 的代理版本要求](clients.md#claude-的代理环境)。
SQLite Durable Objects 支持免费计划但受额度限制，见[官方说明](https://developers.cloudflare.com/durable-objects/platform/pricing/)。
本文是操作者步骤，本次仓库整理只做本地测试及 dry-run，不部署。

## 单频道最短路径

新电脑只建一个频道时：relay → 应用能力与插件/信任 → 第一个 Codex 成员创建频道 → Claude 自己首次加入 → 可选 Grok adapter → 无敏感互通验收。
默认使用 `~/.ccim`，不需要额外 home、session 链接或第二个 adapter。已有桥再加项目才看 [应用接收端的多频道映射](project-receivers.md)。
实际应用身份、可执行 join、hook 注册和新电脑清单统一在 [应用接收端](project-receivers.md)。
**当前不是新电脑一键配置工具**：Claude 应用可能不提供所需 socket/hooks，Codex 的旧 handler 排除和新定义信任须在实际产品上确认。
以下 `<channel>`、`<codex-handle>`、`/private/...` 均须替换为自己的获准名称/路径；历史内容工作站使用 `ginko-bridge/neo-codex`；这些实际旧名称不作为新机默认值。

## 凭据与生成顺序

| 名称 | 何时取得 | 私有存放类别 |
| --- | --- | --- |
| Wrangler 登录凭据 | 浏览器授权登录 | Wrangler 用户配置 |
| 频道 secret | 第一个成员创建频道 | `CCIM_HOME/config.json`，0600 |
| 本地 Codex / Claude token | 各自 join 后 | 各自 `CCIM_HOME/sessions/`，0600 |
| grok token / `CCIM_TOKEN` | 频道存在后 guarded join | 私有文件、adapter Worker secret |
| `MCP_BEARER` | 密码管理器生成至少 32 随机字节 | Worker secret、Grok 安全变量 |
| `WEBHOOK_URL` / `WEBHOOK_KEY` | Grok 创建例程后 | Grok 账号、adapter Worker secrets |
| `OAUTH_ENC_KEY` | 仅可选 OAuth | relay Worker secret；核心路径不需要 |

不把真实值放聊天、Git、命令参数或日志。`.dev.vars.example` 只列占位值，
真实 `.dev.vars` 仅用于本地且忽略。不要将测试凭据上传。

## 0. 新 Cloudflare 账号先启用 workers.dev

登录 Cloudflare，选择目标账号，打开 **Workers & Pages**，在账号的 **Your subdomain**
区域完成首次设置；已有子域时这里是 **Change**。设置账号自己的 workers.dev 子域，
后续 Worker 使用 `Worker名.账号子域.workers.dev`。若尚未显示子域，按账号 Workers
首次启用引导完成设置；不要为此部署无关模板 Worker，也不需要购买域名。
[官方 workers.dev 说明](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)。

本项目两个配置均为 `workers_dev = true`。先确认子域已设置，再登录 Wrangler 和部署。
一个账号的子域由其 Workers 共用，换子域可能影响已有地址，不要在已有服务的账号随意修改。

## 1. relay

```sh
cd relay
npm ci
npm test
cp wrangler.toml wrangler.local.toml
```

编辑忽略的 `wrangler.local.toml`，把 `example-ccim-relay` 换成自己的 Worker 名。
保留 DO bindings/migrations；不填作者域名或账号 ID。缺省关闭，示例显式 `LOOP_GUARD_MAX="0"`。
保持旧关闭行为时部署前必须检查实际配置为0。只接受非负安全整数，非法值回退 256。
旧 `LOOP_GUARD=off` 不再控制此版本，升级必须转换为 `LOOP_GUARD_MAX=0`。

```sh
npx wrangler login
node ../scripts/check-relay-deploy.mjs wrangler.local.toml
npx wrangler deploy --config wrangler.local.toml --dry-run
# 检查必须为0、无--var/环境覆盖；审阅并批准后执行
npm run deploy
```

正式 deploy 成功后，从 Wrangler 输出的 `https://…workers.dev` 行取得 URL，
也可在 Workers & Pages 中点开对应 Worker，在 **Settings → Domains & Routes** 查看 workers.dev 地址。
不要复制预览版本地址；dry-run 不产生可访问 URL。将 relay URL 私密配置到 CCIM_RELAY，
adapter 部署后同样取其 URL，在 Grok 使用该地址加 `/mcp`。

OAuth 默认关闭，relay `/mcp` tools/list 只暴露
`ccim_probe`；频道 API 不受影响。项目没有 relay `/status` 路由。

## 2. 插件、频道、两个本地成员

按[clients](clients.md)安装，核实 hooks 和专用接收会话身份。下文 `ccim` 指
实际插件的 `bin/ccim`，必要时用 `node /实际插件路径/bin/ccim`。
将实际 relay URL 设置到 `CCIM_RELAY`。首次在专用 Codex 接收 chat 执行：

```sh
ccim join "<channel>/<codex-handle>" --if-absent
ccim listen
```

其中 `ccim listen` 也在 **Codex 应用接收对话里让它执行**；不是另开终端版 Codex 或在独立实施线程启动监听。
此步生成频道 secret 和成员 token，保存到私有 `CCIM_HOME`，不回显。
已存在频道/成员、凭据不匹配时停止，不能换名字绕过。
### 不回显地导出频道 secret

在已经创建频道的机器，从仓库根目录执行：

```sh
node scripts/export-channel-secret.mjs "<channel>" /private/channel-secret
```

脚本读取 `$CCIM_HOME/config.json`（未设置 CCIM_HOME 时为 `$HOME/.ccim/config.json`），
只导出指定频道的 secret，不导出成员 token。目标新建为0600，父目录新建为0700，
成功/失败均不输出值；已有目标文件或软链接会拒绝，不能覆盖。不要用 cat、echo、
shell 命令替换或聊天中转。通过密码管理器或已授权的私密传输交给 Claude 所在机器，
接收端也保存为0600文件；不能提交到仓库。完成交接后按自己的凭据备份策略处理临时文件。

### Claude 接入前必查：hook 的代理环境

若该机需代理才能访问 relay，先完成 [Claude 的代理环境](clients.md#claude-的代理环境)：
确认 hooks 能继承已授权的 `HTTP_PROXY` / `HTTPS_PROXY`，并在当前插件缓存的
`SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd` 四条 ccim 命令前加
`NODE_USE_ENV_PROXY=1`。使用 Node 24.5+；只改 ccim hook，不为此修改
Claude 全局 `settings.json`。备份、JSON 示例及升级后复查步骤见链接。
插件更新或重装会覆盖本地缓存的可能性不能忽略，更新后必须重新检查。
无需代理的网络跳过代理修正，仍需验收监听在线。

首次在尚未绑定成员的 Claude 专用会话运行：

```sh
ccim join "<channel>/claude" --if-absent --must-exist --secret-file /private/channel-secret
```

`/private/channel-secret` 是示例，替换为该机 0600 文件。成员 token 由 join 生成，
不是安装前提。未带 `--if-absent` 的 join 仍会接管同名身份，不可误用。
需要代理时，上述手动 join 命令也加 `NODE_USE_ENV_PROXY=1` 前缀。
重启会话后运行 `NODE_USE_ENV_PROXY=1 ccim who`（无需代理时直接 `ccim who`），
确认自己的成员 `online`，再按 [verify](verify.md) 验收获准的无敏感收件。
已加入的成员修正代理后只恢复原监听，不重复 join。手动 who/inbox/send 正常不代表 hook 已继承代理。

## 3. grok 成员与 adapter

在有频道 secret 的机器、仓库根目录运行，输出路径必须为新的私有文件：

```sh
CCIM_HOME="<本频道私有home>" node scripts/provision-grok.mjs "<channel>" /private/grok-member-token "<service-handle>"
```

脚本读 `CCIM_HOME/config.json`，默认 handle 为 `grok`（可选第三参数指定），使用 `ifAbsent:true,mustExist:true`。
不绑定 chat、不启动 listener、不打印 token。已有输出文件会拒绝；超时/失败保留
空文件标记，停止，不直接重试或改成员名。先私下核对 who 和凭据文件，再决定恢复。

```sh
cd adapter
npm ci
npm test
cp wrangler.toml wrangler.local.toml
```

每频道使用各自的本地配置文件，显式填写 Worker 名和 CCIM_RELAY，以及下表全部四项，禁止沿用另一频道示例默认值。provision第三参数必须等于CCIM_HANDLE。

| 频道 | CCIM_CHANNEL | CCIM_HANDLE（provision第三参数） | ALLOWED_RECIPIENTS | STATE_NAMESPACE（稳定示例） | 独立Webhook例程 |
| --- | --- | --- | --- | --- | --- |
| 工作站 | ginko-bridge | grok | claude,neo-codex | `<relay-dataset>/ginko-bridge/grok` | Ginko-Bridge 接收 |
| 项目 | ginkoai | ginkoai-grok | codex,claude | `<relay-dataset>/ginkoai/ginkoai-grok` | GinkoAI 桥接收 |

已有批准且成员仍不存在时，按目标频道分别执行（私有路径均为占位符；不是要求现在创建）：

```sh
CCIM_HOME="/PRIVATE/workstation-home" node scripts/provision-grok.mjs ginko-bridge /PRIVATE/workstation-grok-token grok
CCIM_HOME="/PRIVATE/ginkoai-home" node scripts/provision-grok.mjs ginkoai /PRIVATE/ginkoai-grok-token ginkoai-grok
```

名称是本项目非秘密对应关系，迁移时核实实际映射；存储标识已有值不得照表改写。两频道各有独立Worker、WEBHOOK_URL、WEBHOOK_KEY及例程，绝不共用。创建服务成员示例的第三参数分别为grok和ginkoai-grok；输出文件和CCIM_HOME同样独立。
验收必须核对tools/list中grok_send.inputSchema.properties.to.enum等于本频道ALLOWED_RECIPIENTS，脚本send_recipients输出用于比较；任何错配先停，不发送测试业务。
为 `STATE_NAMESPACE` 选择稳定数据集标识：普通部署或域名别名不改，换独立 relay
才更换，且先完成[rotation](rotation.md)的任务收尾。

先确认 Grok 能安全调用 Bearer MCP。若必须先取得 MCP 地址才能建例程，可先部署 MCP，暂不设置 `WEBHOOK_URL` / `WEBHOOK_KEY`；缺少任一项时不发唤醒请求，不填可触达占位 URL。例程创建后再按授权补这两项。缺 `CCIM_TOKEN` 时 MCP 初始化/工具发现可验，relay 轮询与投递不可宣称通过。
用密码管理器生成 `MCP_BEARER`。以下 secret put 在终端隐藏输入，不在普通 shell
命令行粘贴值；首个 secret put 可能创建占位 Worker，也是需核对账号/名称的云端变更。

```sh
npx wrangler secret put CCIM_TOKEN --config wrangler.local.toml < /private/grok-member-token
npx wrangler secret put MCP_BEARER --config wrangler.local.toml

# 仅取得真实例程字段后补充这两项；否则跳过
npx wrangler secret put WEBHOOK_URL --config wrangler.local.toml
npx wrangler secret put WEBHOOK_KEY --config wrangler.local.toml
npx wrangler deploy --config wrangler.local.toml --dry-run
# 审阅并批准后执行
npx wrangler deploy --config wrangler.local.toml
```

## 4. 确认 adapter 的 cron 在运行

正式部署后，在 Workers & Pages → adapter Worker → Settings → Trigger Events，
核对 cron 为 `* * * * *`。通过该区域 **View events** 查看 Cron Events 的定时调用记录；
不要把一次 HTTP `/health` 成功当作 cron 已运行。触发配置传播最长可能15分钟，
新建/改名 Worker 的历史事件显示最长可能30分钟。见[官方 Cron 文档](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

用 [clients 的安全变量方式](clients.md#从环境变量调用-mcp)运行只读检查脚本两次，间隔至少一分钟：

```sh
node scripts/check-adapter-mcp.mjs
# 至少一分钟后再执行，人工等待即可
node scripts/check-adapter-mcp.mjs
```

看 `poll.at`（毫秒时间戳）是否前进、`poll.ok` 是否为 true。初始 poll=null 表示尚无该作用域的轮询记录；
时间前进但 ok=false 表示 cron 运行了、relay 查询失败；wakes_today=0 可以只是没有需要唤醒的消息。
若未更新，先核对查看的是正确 Worker/STATE_NAMESPACE 和触发配置，再看 Cron Events。
有诊断授权时可在 adapter 目录用 `npx wrangler tail --config wrangler.local.toml`
查看 scheduled 事件与 poll_failed；不要开启请求头/正文调试日志。此步骤不要求发测试消息，
也不触发手工 tick、改 cron 或重新部署。

## 5. Grok 与验收

Grok 配置 adapter URL 加 `/mcp`，Bearer 是 `MCP_BEARER`，不是 relay token。
按[clients](clients.md)映射变量/提示词，再按[verify](verify.md)做三对测试。
initialize 应返回 0.2.0，tools/list 应有五工具。

只验证占位打包时，各包运行 `npx --no-install wrangler deploy --dry-run`，不上传。
`node --test scripts/test/*.test.mjs` 验证安全 provisioning 与 CLI 重建步骤。
换电脑、账号不等于必须删频道或全量轮换，按[rotation](rotation.md)分别处理。
