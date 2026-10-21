# 重建 Ginko-Bridge

从 `https://github.com/ginkoten/ccim` clone 完整历史；升级测试会读取历史提交。
Node 22+、npm、Cloudflare 免费账号是前提，本地验证使用 Node 24。
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

记录实际回执 URL 到私有配置。OAuth 默认关闭，relay `/mcp` tools/list 只暴露
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
通过密码管理器或私有文件将频道 secret 交给 Claude 所在机器，在其专用会话运行：

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

## 4. Grok 与验收

Grok 配置 adapter URL 加 `/mcp`，Bearer 是 `MCP_BEARER`，不是 relay token。
按[clients](clients.md)映射变量/提示词，再按[verify](verify.md)做三对测试。
initialize 应返回 0.2.0，tools/list 应有五工具。

只验证占位打包时，各包运行 `npx --no-install wrangler deploy --dry-run`，不上传。
`node --test scripts/test/*.mjs` 验证安全 provisioning 与 CLI 重建步骤。
换电脑、账号不等于必须删频道或全量轮换，按[rotation](rotation.md)分别处理。
