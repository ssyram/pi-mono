# T3 桥接候选状态

运行 529d0113-6a80-4d5e-acc6-465354d9320f 在 900000ms 超时。

已存在的试验扩展：`my-plugins/model-scout/mechanism/bin/scout-bridge-t3/index.ts`（仓库相对路径）。

该文件只是未完成机制工件，不是产品插件；本轮没有交回试验脚本、通过日志或退出码，不能推定能加载或可调用。原 agent 的“Extension 写好”只描述其意图，不构成正确性证据。

尚无本候选的已运行证明：首次解析/重启恢复、桥接鉴权与原 transport、官方接管退出、禁用残留、两种加载顺序。用户新增 Shift+Tab thinking levels 和 context length 标准未被该 child 消费，已在 docs/acceptance.md 保留。

未进入产品实现和最终真实 tmux 验收。停止自动续跑同一探索任务；原始 transcript 和 metadata 由宿主保留。失败不证明候选不可行，也不允许把现存试验扩展交给用户当成完成品。

## 收取源码后发现的落实偏差

主会话全文读取上述试验扩展后确认：注册仍在 session_start，而非本次要求的加载期；仍保留 restoreSavedSelection/pi.setModel 的事后补救；虚拟入口 contextWindow=111000、物理桥接 contextWindow=222000 为不同试验值；原账号鉴权仅直接转交桥接的 input，尚无证明能解析原账号 stored credential；shutdown 未注销物理桥接。该工件既不能证明首次解析前可见，也不能证明凭据委托、失败恢复和真实元数据要求，不能继续作为正确路线跑测试或转成产品。

下一步权限边界：现有机制证据只支持启动后补充；要完整支持具名账号缓存模型的启动选择/恢复，需要已注册 native 可读且首次模型解析前可运行的接入点。允许调查最小宿主接口扩展须由用户明确授权；未获授权不修改核心、其他插件或实际安装。不宣称已穷尽全部理论上的纯插件组合，也不以此继续无界探索或缩小验收标准。

