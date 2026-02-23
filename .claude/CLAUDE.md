# Pi-Mono 深度分析 - 长期记忆

## 项目目标
基于 pi-mono 构建"朝廷"多层 Coding Agent：丞相(任务分配) + 史官(监控进言) + 九卿(中层分配) + 执行层

## 核心结论
- **路线**：Extension 一条路走到底，不需要 SDK
- **多 Extension**：完全支持同时加载，链式派发，EventBus 跨扩展通信
- **上下文控制**：`context` 事件每次 LLM 调用前拦截，改的是深拷贝不影响持久化
- **Skill scope 化**：context 事件过滤 + appendEntry 持久化但不占上下文
- **子 Agent 隔离**：spawn("pi", ["--no-session", "--mode", "json"]) 独立进程
- **角色限制**：setActiveTools 剥夺工具 + 环境变量控制 Extension 行为
- **TUI 复用**：Extension 可注册命令/overlay/widget/编辑器/页头页脚

## 调查完成状态
- [x] A-F: 6 域分析
- [x] G: 综合索引 + 开发指南
- [x] court-architecture: 朝廷架构设计
- [x] C-detailed: Extension 代码级分析（28种事件、30+方法、7个emit函数）
- [x] H: Extension 开发/安装/测试/发布流程

## 文档树
reports/00-investigation-methodology.md → 01-index.md → A~F域 → G-dev-guide.md
→ court-architecture.md → C-extension-system-detailed.md → H-extension-dev-workflow.md
