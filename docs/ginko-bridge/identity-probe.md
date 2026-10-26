# 暂停期间的只读身份探测

在既有鉴权MCP入口调用`grok_status({"health":true,"probe_identity":true})`，使用当前Worker实际绑定的凭据，向配置的频道发一次GET who并校验返回you等于配置handle。返回probe.source、checked_at和脱敏身份结果。direct之外返回不支持，不刷新OAuth。

无论探测成功或失败，都不写停止/恢复/业务账本，不读队列、不ACK、不发送、不唤醒、不解除blocked。普通health保持原来blocked时只报告缓存状态的行为；实时探测必须显式请求。只有health和probe_identity组合可用，未鉴权请求仍被拒绝。

身份通过不等于允许恢复业务。恢复前须按 [旧消息隔离](backlog-isolation.md) 安装并验证持久边界，再按 [服务成员恢复](service-auth.md) 明确批准单次 AUTH_RECHECK_APPROVAL。未安装隔离时，恢复后的 cron 会处理原有未读消息。

在已获准安全环境注入 MCP Bearer 后，可运行 `node scripts/check-adapter-mcp.mjs --probe-identity`。该脚本不读取私有凭据文件、不消费 inbox；显式标记才发 Worker 绑定身份实时探测。输出 identity_probe 的 source/checked_at、auth_stop_at 和最近 poll，不能把检查完成的退出码当成认证通过。若环境未提供凭据或访问被拒，停止并由已有获准接口转交结果，不读取受限 session/token 文件绕过。
