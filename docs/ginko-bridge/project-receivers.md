# 应用接收端与多频道身份映射

本修复保持 main 的标准插件接收机制，不引入其他分支的可靠投递运行时、管理服务或终端接收器。能力及身份须在实际应用内核实，未在新电脑实机验证。

## 1. 检查应用能力与真实身份

在目标 Codex 应用内恢复既有专用接收对话，核对运行时提供的真实 CODEX_THREAD_ID、插件启用/信任、官方CLI的queue能力和Node版本。Claude须在其应用支持的执行工具内核实真实session、hooks和inbox socket能力；普通桌面聊天不自动具有这些能力。缺失时报告，不创建终端会话冒充，不借其他对话ID。

检查仓库指引及已安装插件的help，不打印环境或凭据。hooks必须找到实际Node/插件路径并继承已获准网络设置；不要复制旧电脑路径或重写信任数据库。

接收对话名：工作站为「Ginko-Bridge 本地接收 · 接替」，GinkoAI 项目使用独立的本地专用接收对话（新机须先记录实际名称，不能猜ID）。长任务/实施对话不要join占用相同handle：不带guard的同名join会替换token并挤掉原接收端。普通恢复在原接收对话复用session，不能靠新任务对话接管修离线。

## 2. 首次安装与接替

仅批准首次创建且成员不存在时，在本人的应用接收对话按 [rebuild](rebuild.md) guarded join；已有频道加入带 mustExist。已有成员、409或未知结果停查，不重join修离线。普通启动复用session。

Codex在自己的应用接收对话执行标准listen，hooks维持监听；不要在实施对话启动第二监听。标准实现检查本session已有listenerPid，不保证跨机器所有权；接替前须由旧接收端明确停用，并核对在途投递和旧任务。不要因新电脑未看到旧进程便认为全局无在途操作，也不能杀其他频道进程。

## 3. 多频道映射与发现链接

每个频道登记独立私有CCIM_HOME、真实session、成员、Worker、存储namespace和安全变量名，使用 [离线配置预检](rebuild.md) 验证声明。共享relay不等于共享token；Grok成员token只写对应Worker，不给客户端使用。

默认插件从 `~/.ccim/sessions/<REAL_SESSION_UUID>.json` 发现本session；项目home不同时，已获准的本机配置可将它链接到 `/ABSOLUTE/PROJECT_CCIM_HOME/sessions/<同一真实ID>.json`。先检查链接现状和同一身份映射，不覆盖不同目标。默认home已有身份时无需链接；不得读取受限会话或提取token来建立链接，不从其他对话复制身份。本人信任与私密凭据交接仍走正式安全入口。

端口通常为null，不为接入新增常驻服务。若确有既有获准的本地端口，须按频道登记独占。标准who/status只证明相应时刻的身份/监听；接收、唤醒、执行和回执按 [verify](verify.md) 分层验收。inbox会ACK，不能当只读查询。认证失败、未知业务结果不清队列或换clientId。
