# 重建 Ginko-Bridge

从 `https://github.com/ginkoten/ccim` clone 完整历史；升级测试会读取历史提交。
部署机器需要 Node 22+、npm 和 Cloudflare 免费账号；**每台运行 ccim 的 Codex/Claude 客户端机器也需要 Node 22+**，
不能只在部署机器安装。运行 MCP 示例脚本的 Grok 执行环境也需 Node 22+。
本地验证使用 Node 24；依赖环境代理时另见 [clients 的代理版本要求](clients.md#claude-的代理环境)。
SQLite Durable Objects 支持免费计划但受额度限制，见[官方说明](https://developers.cloudflare.com/durable-objects/platform/pricing/)。
本文是操作者步骤，本次仓库整理只做本地测试及 dry-run，不部署。

## 凭据与生成顺序

| 名称 | 何时取得 | 私有存放类别 |
| --- | --- | --- |
| Wrangler 登录凭据 | 浏览器授权登录 | Wrangler 用户配置 |
| 频道 secret | 第一个成员创建频道 | `CCIM_HOME/config.json`，0600 |
| neo-codex / claude token | 各自 join 后 | 各自 `CCIM_HOME/sessions/`，0600 |
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
保留 DO bindings/migrations；不填作者域名或账号 ID。默认 `LOOP_GUARD_MAX="256"`，
明确选择关闭才设 `"0"`。只接受非负安全整数，非法值回退 256。
旧 `LOOP_GUARD=off` 不再控制此版本，升级必须转换为 `LOOP_GUARD_MAX=0`。

```sh
npx wrangler login
npx wrangler deploy --config wrangler.local.toml --dry-run
# 审阅并批准后执行
npx wrangler deploy --config wrangler.local.toml
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
ccim join ginko-bridge/neo-codex --if-absent
ccim listen
```

此步生成频道 secret 和成员 token，保存到私有 `CCIM_HOME`，不回显。
已存在频道/成员、凭据不匹配时停止，不能换名字绕过。
### 不回显地导出频道 secret

在已经创建频道的机器，从仓库根目录执行：

```sh
node scripts/export-channel-secret.mjs ginko-bridge "$HOME/.config/ginko-bridge/channel-secret"
```

脚本读取 `$CCIM_HOME/config.json`（未设置 CCIM_HOME 时为 `$HOME/.ccim/config.json`），
只导出指定频道的 secret，不导出成员 token。目标新建为0600，父目录新建为0700，
成功/失败均不输出值；已有目标文件或软链接会拒绝，不能覆盖。不要用 cat、echo、
shell 命令替换或聊天中转。通过密码管理器或已授权的私密传输交给 Claude 所在机器，
接收端也保存为0600文件；不能提交到仓库。完成交接后按自己的凭据备份策略处理临时文件。

在 Claude 的专用会话运行：

```sh
ccim join ginko-bridge/claude --if-absent --must-exist --secret-file /private/channel-secret
```

`/private/channel-secret` 是示例，替换为该机 0600 文件。成员 token 由 join 生成，
不是安装前提。未带 `--if-absent` 的 join 仍会接管同名身份，不可误用。

## 3. grok 成员与 adapter

在有频道 secret 的机器、仓库根目录运行，输出路径必须为新的私有文件：

```sh
node scripts/provision-grok.mjs ginko-bridge /private/grok-member-token
```

脚本读 `CCIM_HOME/config.json`，固定 `grok` 并使用 `ifAbsent:true,mustExist:true`。
不绑定 chat、不启动 listener、不打印 token。已有输出文件会拒绝；超时/失败保留
空文件标记，停止，不直接重试或改成员名。先私下核对 who 和凭据文件，再决定恢复。

```sh
cd adapter
npm ci
npm test
cp wrangler.toml wrangler.local.toml
```

更换本地 Worker 名、`CCIM_RELAY`；频道和 handle 与前一步一致。
为 `STATE_NAMESPACE` 选择稳定数据集标识：普通部署或域名别名不改，换独立 relay
才更换，且先完成[rotation](rotation.md)的任务收尾。

先确认 Grok 能安全调用 Bearer MCP，并创建例程取得 webhook URL/key。
用密码管理器生成 `MCP_BEARER`。以下 secret put 在终端隐藏输入，不在普通 shell
命令行粘贴值；首个 secret put 可能创建占位 Worker，也是需核对账号/名称的云端变更。

```sh
npx wrangler secret put CCIM_TOKEN --config wrangler.local.toml < /private/grok-member-token
npx wrangler secret put MCP_BEARER --config wrangler.local.toml
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
`node --test scripts/test/*.mjs` 验证安全 provisioning 与 CLI 重建步骤。
换电脑、账号不等于必须删频道或全量轮换，按[rotation](rotation.md)分别处理。
