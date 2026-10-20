全部处置核验完毕。写复检报告(无写工具，按运行时约定以最终回复交付，由 runtime 持久化到绑定输出路径)。

---

# fsm-5-watch-install 实施对照 — P1 修复与 P2 处置复检报告

结论：**P1 已闭合，P2-1/2/4/5/6 处置到位，P2-3 按记录处置；改判 PASS(0 critical / 0 unresolved)**。
复检范围：原 audit-report-initial.md 的 BLOCK 项及授权处置清单；严格只读，直读 6 文件 + 1 处类型核对，未执行命令，未复跑测试。

## 一、P1 闭合核验(组装失败回收窗口)

`src/runtime/owned-runtime.ts` 逐点核对：
- **try 起点提前**:`try {` 现位于 `installNotReadyGate` 调用之前，且带显式注释 `// Step P4: every acquisition below sits inside one unwind scope; any throw reverse-frees handlers, scope dir, bridge and channel.`。pre-try 段仅剩 buildAdmissionPolicy/createRootBinding/store.publishExecution/RootHealth/RuntimeResources 构造——该段任一抛错时确无任何 handler、目录或监听已建立，窗口消除。
- **launch scope 目录登记**:`resources.own(async () => { await rm(launchScope, ...) })` 在 openScope 成功后登记，失败路径经 catch 的 `resources.close` 逆序回收。
- **listen 与回收的行序**:`const bridgeUrl = await server.listen(); resources.own(() => server.close());`——listen 抛错时无已绑定 socket 需回收，listen 成功后任何失败(含 channel/工具/门禁段)均入 catch 逆序回收。
- **return 移入 try**:成功返回句柄在 unwind scope 内，catch 路径 `bound=false → health.close → gateOffs 逆序 → resources.close` 与 `handle.close` 同序列。
- **失败路径测试**:`test/assembly.test.ts` 新增 "assembly failure unwinds gates, launch scope, bridge and channel with zero residue",注入恒回 CAPABILITIES 的坏 daemon(使 register 读回校验失败触发 catch),断言 reject 后 `handlers.size === 0` 且 `tools.size === 0`——原 P1 的可观察残留(not-ready gate handler、投影工具)有直接断言；桥 socket 关闭与 scope 目录删除由 catch 的 resources.close 结构性覆盖，测试未逐一断言(见 residual 备注，不阻塞)。

原 P1 的两个构成(窗口 + 测试缺失)均已闭合。

## 二、P2 处置逐项核验

- **P2-1(index 重入)**:`src/index.ts` session_start 现以 `if (handle) { await handle.close(...); handle = undefined; }` 先回收旧 runtime 再重建 ✓。
- **P2-2(ask 按能力注册)**:`owned-runtime.ts` 中 `if (ctx.hasUI) gateOffs.push(registerAskTool(...))`;`ctx.hasUI` 为 pi 1.0.3 真实字段(`types.d.ts:219`,"Whether dialog-capable UI is available (true in TUI and RPC modes)");组装测试 ctx 补 `hasUI:true` 且工具集断言不变；execute 内无 UI isError 兜底保留(纵深防御)✓。
- **P2-3(child 目标 drain)**:按记录处置——`isIdle` 谓词维持根 session 侧，child 侧接线时接入；记录于修复文档，接受 ✓。
- **P2-4(Step 注释)**:`ask-tool.ts` 两处 `// Step P1: ...`(等待态设置先于 dialog、release 在真实回答/取消之后);`drain-advisories.ts` `// Step P3: consumption evidence first, then scheduling for idle targets.` ✓。
- **P2-5(安装计划)**:`plan.ts` 新增 `managed-bootstrap` 步骤，显式声明“当前入口注册单内置 factory;companion-factory manifest 生成(顶层静态 import)为核心后安装增强”;pi-sdk 步骤补 overrides 说明(overrides pin 1.0.3)✓。
- **P2-6(recover 测试)**:`assembly.test.ts` 新增 "recoverRuntime reuses prepare, refreshes source-auth and never replays mutations":fake requester 按合同应答 capabilities→register null→六字段读回→identity→source-auth,断言 catalog 非空、`/evidence/source-auth` 恰出现 1 次、`channel.close` 收尾 ✓。

修复记录 `docs/fixes/fsm5-audit-fix-blockers.md` 与实际 diff 逐条吻合，无以修改测试弱化门槛的情形；新增两条测试均为合同行为断言。

## 三、遗留备注(均为记录级，不构成放行条件)

1. 失败路径测试未直接断言桥 socket 关闭与 scope 目录删除(结构性覆盖；如后续加固可加“close 后端口/目录不存在”断言)。
2. recover 测试的“不重放”仅以 source-auth 恰一次计数承载，请求序列全量断言可再加严。
3. 全量 117 项(115+2)+ tsc 0 为实现方报告，本轮按边界未独立复跑。

## 四、判定

P1 闭合、六项处置到位，无新增差异。fsm-5-watch-install 实施对照结算 **PASS(0 critical / 0 unresolved)**;边界不变：SA 真实子进程集成、真实模型 E2E 属安装后验证(须账户/预算授权)，P10 mandatory 命令翻译为下一责任。