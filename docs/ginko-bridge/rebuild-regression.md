# 复建回归证据（2026-10-25）

本次main隔离分支基于8eb9b70，原7bbbf83及其分支保留；不包含另一个本地分支的 #138 查询功能，不改原工作树或生产。adapter/src 与已验收97540f5逐文件一致；relay新增生命周期事务审计，尚未部署。

## 可重复离线检查

使用 Node 24.5+，完整 clone 后在 relay、adapter 各运行 npm ci。下列测试只用临时目录、假凭据、本机服务或内存DO；不需要生产登录：

```sh
node --test adapter/test/*.test.js scripts/test/*.test.mjs
npm test --prefix relay
node scripts/check-channel-layout.mjs scripts/channel-layout.example.json
cd adapter
npx --no-install wrangler deploy --dry-run
```

- main隔离版本重新测试：adapter/脚本127项通过，relay62项通过，共189项，0失败/跳过；dry-run通过。旧候选263项历史结果不作为新版本通过证明。
- 新增测试验证不同频道入口Bearer、下游token、允许收件人、存储停止状态隔离；临时双home分别读取自己的假session/token，who不触发join、不改session，错误session拒绝。纯配置预检拒绝home/session/Worker/storage/端口和Bearer变量碰撞。
- 已整合回归覆盖guarded join及409不覆盖、成员缺失、审计事务失败、401停止、绑定只读探测、恢复中断及旧请求迟到、隔离重启/并发/迟到旧ID、旧记录和uncertain保留、新消息通过。
- 首次沙箱测试因禁止127.0.0.1监听失败；获得仅本地测试执行能力后同套通过，不把环境失败伪装成功。构建dry-run通过，未发布。
- 历史编译产物兼容性10项在10月24日已通过；依赖本地保存的线上bundle，文件不提交Git，不纳入新机可重复CI，不计入本次main版本回归。
- 变更文件静态secret扫描：无真实凭据/私有配置/session文件；URL用户密码模式命中两处既有/新增负例，人工确认均是 example.invalid 测试字面值。此为启发式扫描，不保证识别任意未知格式。

本分支不新增或修改 GitHub Actions 工作流，用户只批准 Contents/Pull requests 写权限。发布后检查已有CI；若无工作流，则报告CI不存在，不声称CI通过。

未验证边界：未在第二台真实新电脑安装应用/信任插件/接替会话；未再次验证生产最新版本或实际业务完成；未为共享relay部署审计。新机仍须按 [rebuild](rebuild.md) 和 [verify](verify.md) 完成应用能力与分层验收。
