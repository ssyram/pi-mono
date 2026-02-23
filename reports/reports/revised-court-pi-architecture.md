# 朝廷架构 Pi Extension 实现设计

> 文档版本: v1
> 日期: 2026-02-23
> 基于: 辩论修订版规格 (reports/revised-court-spec.md)
> 平台: Pi Extension

## 1. 概述

本文档详细描述修订版朝廷架构在 Pi Extension 平台上的完整实现。核心设计原则来自 5 场多模型对抗辩论的结论，包括分级闸门审查模型、锚点账本上下文管理、机械提取事实包、双层客观监督和声明式清单工具管理。

实现分为八个核心模块：角色路由入口、CAL 锚点账本、分级闸门史官触发、机械提取事实包、ObjectiveNode 元数据提取、Manifest-Driven Clerk、完整事件时序和文件结构。每个模块都映射到具体的 Pi Extension API。

## 2. 角色路由入口 (index.ts)

### 2.1 设计原理

Pi Extension 在每个子进程加载时执行入口函数。通过环境变量 `PI_COURT_ROLE` 区分当前进程角色，实现零代码修改的角色隔离。worker 角色完全跳过注册以保证轻量性，minister 角色仅注册 delegate 工具，chancellor 角色注册完整的事件链和工具。

### 2.2 实现代码

```typescript
import type { ExtensionAPI, AgentMessage } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { delegateTool } from "./delegate.js";
import { runHistorian, RiskLevel } from "./historian.js";
import { CourtState } from "./state.js";
import { CALManager } from "./cal.js";
import { ManifestClerk } from "./manifest.js";
import type { CourtRole } from "./types.js";

const CHANCELLOR_SYSTEM_PROMPT = `你是丞相，负责接收用户指令、分析任务、制定执行计划。
你只能使用 read 和 delegate 两个工具，不能直接执行代码。
通过 delegate 将任务分配给九卿或执行层，等候结果返回后汇总给用户。`;

export default function court(pi: ExtensionAPI): void {
    const role: CourtRole = (process.env.PI_COURT_ROLE as CourtRole) || "chancellor";

    if (role === "worker") {
        return;
    }

    if (role === "minister") {
        pi.registerTool(delegateTool);
        return;
    }

    const state = new CourtState();
    const cal = new CALManager(pi);
    const clerk = new ManifestClerk(pi, state);

    pi.on("session_start", async () => {
        const manifest = await clerk.loadOrCreateManifest();
        pi.setActiveTools(manifest.currentPhase.allowedTools);
        cal.initialize();
    });

    pi.on("before_agent_start", async (event, ctx) => {
        const activeAnchors = cal.getActiveAnchors();
        const lastAdvice = state.getLastHistorianAdvice();
        
        let systemPrompt = CHANCELLOR_SYSTEM_PROMPT;
        
        if (activeAnchors.length > 0) {
            systemPrompt += `\n\n## 朝廷锚点\n${activeAnchors.map(a => 
                `[${a.type}] ${a.content}`).join("\n")}`;
        }
        
        if (lastAdvice) {
            systemPrompt += `\n\n## 史官进言\n${lastAdvice}`;
        }

        return { systemPrompt };
    });

    pi.on("agent_end", async (event, ctx) => {
        const messages = event.messages;
        const lastAssistant = messages.filter(m => m.role === "assistant").pop();
        
        if (!lastAssistant) {
            return;
        }

        const riskLevel = await assessRiskLevel(messages, state);
        
        if (riskLevel === "L0") {
            return;
        }

        const factPacket = buildFactPacket(messages, ctx, state);
        
        const historianResult = await runHistorian(factPacket, riskLevel, pi, ctx);

        if (historianResult.record) {
            cal.appendEntry("historian-record", historianResult.record);
        }

        if (historianResult.advice) {
            state.setLastHistorianAdvice(historianResult.advice);
            
            if (riskLevel === "L2" || riskLevel === "L3") {
                pi.sendMessage(
                    {
                        customType: "historian-urgent-advice",
                        content: historianResult.advice,
                        display: true,
                    },
                    { deliverAs: "nextTurn" }
                );
            } else {
                pi.sendMessage(
                    {
                        customType: "historian-advice",
                        content: historianResult.advice,
                        display: false,
                    },
                    { deliverAs: "nextTurn" }
                );
            }

            if (historianResult.riskFlags && historianResult.riskFlags.length > 0) {
                for (const flag of historianResult.riskFlags) {
                    cal.addAnchor({
                        id: flag.id,
                        type: "RISK_HIGH",
                        content: flag.description,
                        createdAt: Date.now(),
                        expiresOn: "TASK_COMPLETED",
                    });
                }
            }
        }

        const delegateResults = extractDelegateResults(messages);
        for (const result of delegateResults) {
            if (result.status === "completed") {
                cal.addAnchor({
                    id: `decision-${result.taskId}`,
                    type: "DECISION",
                    content: result.summary,
                    taskId: result.taskId,
                    createdAt: Date.now(),
                    expiresOn: "NEVER",
                });
                cal.removeAnchorsByType("TASK_ACTIVE", result.taskId);
            } else if (result.status === "in_progress") {
                cal.addAnchor({
                    id: `task-${result.taskId}`,
                    type: "TASK_ACTIVE",
                    content: result.description,
                    taskId: result.taskId,
                    createdAt: Date.now(),
                    expiresOn: "TASK_COMPLETED",
                });
            }
        }
    });

    pi.on("context", async (event, _ctx) => {
        const filtered = state.filterContext(event.messages, cal);
        
        const activeRisks = cal.getAnchorsByType("RISK_HIGH");
        if (activeRisks.length > 0) {
            const riskWarning = activeRisks.map(r => 
                `⚠️ 风险警告 [${r.id}]: ${r.content}`
            ).join("\n");
            
            return {
                messages: filtered,
                prependMessages: [{
                    role: "system",
                    content: riskWarning,
                }],
            };
        }
        
        return { messages: filtered };
    });

    pi.on("session_before_compact", async (event, ctx) => {
        const activeRisks = cal.getAnchorsByType("RISK_HIGH");
        
        if (activeRisks.length > 0 && activeRisks.length < 3) {
            return;
        }

        const summary = await generateCourtSummary(event.messages, cal);
        
        return {
            compaction: {
                summary,
                firstKeptEntryId: event.preparation.firstKeptEntryId,
                tokensBefore: event.preparation.tokensBefore,
                details: {
                    courtAnchors: cal.serialize(),
                    hasActiveRisks: activeRisks.length > 0,
                },
            },
        };
    });

    pi.registerTool(delegateTool);
    pi.registerCommand("court-status", {
        description: "查看朝廷状态",
        handler: async (_args, _ctx) => {
            return {
                content: formatCourtStatus(state, cal, clerk),
            };
        },
    });

    pi.registerCommand("court-manifest", {
        description: "查看或更新 Court Manifest",
        handler: async (args, _ctx) => {
            if (args.action === "view") {
                return { content: clerk.getCurrentManifest() };
            }
            if (args.action === "update-phase") {
                clerk.switchPhase(args.phase);
                pi.setActiveTools(clerk.getCurrentTools());
                return { content: `已切换到阶段: ${args.phase}` };
            }
            return { content: "未知操作" };
        },
    });
}

async function assessRiskLevel(
    messages: AgentMessage[],
    state: CourtState
): Promise<RiskLevel> {
    const toolCalls = messages
        .filter(m => m.role === "assistant" && m.toolCalls)
        .flatMap(m => m.toolCalls || []);

    const hasBash = toolCalls.some(t => t.name === "bash");
    if (hasBash) {
        return "L2";
    }

    const hasMcp = toolCalls.some(t => t.name.startsWith("mcp_"));
    if (hasMcp) {
        return "L2";
    }

    const hasWrite = toolCalls.some(t => 
        t.name === "write" || t.name === "edit" || t.name === "delete"
    );
    if (hasWrite) {
        return "L1";
    }

    const hasDelegate = toolCalls.some(t => t.name === "delegate");
    if (hasDelegate) {
        return "L1";
    }

    return "L0";
}

function extractDelegateResults(messages: AgentMessage[]): DelegateResult[] {
    const results: DelegateResult[] = [];
    
    for (const msg of messages) {
        if (msg.role === "tool" && msg.toolName === "delegate") {
            const content = typeof msg.content === "string" 
                ? msg.content 
                : JSON.stringify(msg.content);
            
            try {
                const parsed = JSON.parse(content);
                results.push({
                    taskId: parsed.taskId,
                    status: parsed.status,
                    summary: parsed.summary,
                    description: parsed.description,
                });
            } catch {
                results.push({
                    taskId: msg.toolCallId,
                    status: "completed",
                    summary: content.slice(0, 200),
                    description: "",
                });
            }
        }
    }
    
    return results;
}

async function generateCourtSummary(
    messages: AgentMessage[],
    cal: CALManager
): Promise<string> {
    const anchors = cal.getAllAnchors();
    
    const decisions = anchors
        .filter(a => a.type === "DECISION")
        .map(a => `- ${a.content}`);
    
    const activeTasks = anchors
        .filter(a => a.type === "TASK_ACTIVE")
        .map(a => `- ${a.content}`);

    return `## 朝廷历史摘要

### 已完成决策
${decisions.length > 0 ? decisions.join("\n") : "无"}

### 进行中任务
${activeTasks.length > 0 ? activeTasks.join("\n") : "无"}

### 近期操作
(由压缩系统自动生成)`;
}

function formatCourtStatus(
    state: CourtState,
    cal: CALManager,
    clerk: ManifestClerk
): string {
    const anchors = cal.getAllAnchors();
    const manifest = clerk.getCurrentManifest();
    
    return `## 朝廷状态

### 当前阶段
${manifest.phases.current}

### 锚点账本
- DECISION: ${anchors.filter(a => a.type === "DECISION").length}
- TASK_ACTIVE: ${anchors.filter(a => a.type === "TASK_ACTIVE").length}
- RISK_HIGH: ${anchors.filter(a => a.type === "RISK_HIGH").length}

### 史官建议
${state.getLastHistorianAdvice() || "无"}`;
}
```

### 2.3 角色判定逻辑

| 角色 | 环境变量 | 注册内容 | 说明 |
|------|----------|----------|------|
| worker | `PI_COURT_ROLE=worker` | 无 | 完全透明，零开销 |
| minister | `PI_COURT_ROLE=minister` | delegate 工具 | 可继续委托 |
| chancellor | 未设置或其他 | 完整事件链 + 工具 + 命令 | 主进程 |

## 3. CAL 锚点账本实现

### 3.1 设计原理

Court Anchor Ledger 是修订版架构的核心创新之一。区别于简单的时间戳过期机制，CAL 通过语义事件驱动锚点生命周期。高风险警告基于"问题解决"语义清除，而非 TTL 轮次计数。锚点存储在 session 持久化区，通过 `appendEntry` 写入但标记为 `custom` 类型以避免进入 LLM 上下文。

### 3.2 核心类型定义

```typescript
type AnchorType = "DECISION" | "RISK_HIGH" | "TASK_ACTIVE";

interface Anchor {
    id: string;
    type: AnchorType;
    taskId?: string;
    content: string;
    createdAt: number;
    expiresOn: "NEVER" | "TASK_COMPLETED" | "EXPLICIT_RESOLVED";
    persistedRef?: string;
}

interface CALEntry {
    type: "court-anchor";
    anchor: Anchor;
    resolvedAt?: number;
    resolutionType?: "completed" | "resolved" | "expired";
}
```

### 3.3 CAL 管理器实现

```typescript
import type { ExtensionAPI, AgentMessage } from "@mariozechner/pi-coding-agent";

export class CALManager {
    private pi: ExtensionAPI;
    private anchors: Map<string, Anchor> = new Map();
    private sessionId: string | null = null;

    constructor(pi: ExtensionAPI) {
        this.pi = pi;
    }

    initialize(): void {
        this.sessionId = this.generateSessionId();
        this.loadFromSession();
    }

    private generateSessionId(): string {
        return `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    private loadFromSession(): void {
        const entries = this.pi.getEntries?.("court-anchor") || [];
        
        for (const entry of entries) {
            if (entry.type === "court-anchor" && entry.anchor) {
                if (!this.isExpired(entry.anchor)) {
                    this.anchors.set(entry.anchor.id, entry.anchor);
                }
            }
        }
    }

    private isExpired(anchor: Anchor): boolean {
        if (anchor.expiresOn === "NEVER") {
            return false;
        }

        if (anchor.expiresOn === "EXPLICIT_RESOLVED") {
            return false;
        }

        return false;
    }

    addAnchor(anchor: Anchor): void {
        this.anchors.set(anchor.id, anchor);
        
        this.pi.appendEntry("court-anchor", {
            type: "court-anchor",
            anchor,
        });
    }

    removeAnchor(id: string): void {
        const anchor = this.anchors.get(id);
        if (!anchor) {
            return;
        }

        this.anchors.delete(id);

        this.pi.appendEntry("court-anchor", {
            type: "court-anchor",
            anchor: {
                ...anchor,
                resolvedAt: Date.now(),
                resolutionType: "resolved",
            },
        });
    }

    removeAnchorsByType(type: AnchorType, taskId?: string): void {
        for (const [id, anchor] of this.anchors) {
            if (anchor.type === type) {
                if (!taskId || anchor.taskId === taskId) {
                    this.removeAnchor(id);
                }
            }
        }
    }

    resolveTaskAnchors(taskId: string): void {
        for (const [id, anchor] of this.anchors) {
            if (anchor.taskId === taskId) {
                if (anchor.expiresOn === "TASK_COMPLETED") {
                    this.removeAnchor(id);
                }
            }
        }
    }

    getActiveAnchors(): Anchor[] {
        const result: Anchor[] = [];
        const now = Date.now();

        for (const anchor of this.anchors.values()) {
            if (anchor.type === "RISK_HIGH") {
                result.push(anchor);
            }
        }

        return result;
    }

    getAnchorsByType(type: AnchorType): Anchor[] {
        return Array.from(this.anchors.values()).filter(a => a.type === type);
    }

    getAllAnchors(): Anchor[] {
        return Array.from(this.anchors.values());
    }

    checkResolutionSignal(messages: AgentMessage[]): void {
        const resolutionPattern = /\[RESOLVED:\s*([^\]]+)\]/;
        
        for (const msg of messages) {
            if (msg.role === "user") {
                const matches = msg.content?.match(resolutionPattern);
                if (matches) {
                    const riskId = matches[1].trim();
                    this.removeAnchor(riskId);
                }
            }
        }
    }

    serialize(): SerializedAnchor[] {
        return Array.from(this.anchors.values()).map(a => ({
            id: a.id,
            type: a.type,
            content: a.content,
            taskId: a.taskId,
            createdAt: a.createdAt,
            expiresOn: a.expiresOn,
        }));
    }
}
```

### 3.4 Context 事件集成

```typescript
pi.on("context", async (event, _ctx) => {
    const messages = event.messages;
    const cal = state.getCAL();

    cal.checkResolutionSignal(messages);

    const filtered: AgentMessage[] = [];
    let skipCount = 0;

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === "tool" && msg.toolName === "delegate") {
            const taskId = msg.toolCallId;
            const decisionAnchor = cal.getAnchorsByType("DECISION")
                .find(a => a.taskId === taskId);

            if (decisionAnchor && skipCount < 3) {
                skipCount++;
                continue;
            }
        }

        if (msg.role === "custom" && 
            (msg as any).customType === "historian-advice") {
            const age = Date.now() - ((msg as any).timestamp || 0);
            if (age > 2 * 60 * 60 * 1000) {
                continue;
            }
        }

        filtered.push(msg);
    }

    const riskAnchors = cal.getAnchorsByType("RISK_HIGH");
    
    if (riskAnchors.length > 0) {
        const systemWarnings = riskAnchors.map(a => 
            `⚠️ 风险: ${a.content}`
        ).join("\n\n");

        return {
            messages: filtered,
            prependMessages: [{
                role: "system",
                content: systemWarnings,
            }],
        };
    }

    return { messages: filtered };
});
```

## 4. 分级闸门史官触发

### 4.1 设计原理

修订版架构的核心改进之一是分级闸门模型。L0 无风险操作直接跳过史官，避免不必要的性能开销。L1 低风险操作触发异步史官，用户体验不受影响但审查结果会注入下一轮。L2 高风险操作同步阻塞，用户必须等待审查完成才能看到结果。L3 终局在 session 压缩前触发，进行深度审查。

风险矩阵硬编码，避免 LLM 判断引入的不确定性。

### 4.2 风险矩阵定义

```typescript
const RISK_MATRIX = {
    LOW_RISK: ["read_file", "list_dir", "search_code", "grep", "glob"],
    MED_RISK: ["write_file", "edit_file", "delegate", "create_directory"],
    HIGH_RISK: ["bash", "mcp_*", "delete_file", "delete_directory"],
    SENSITIVE_PATTERNS: [
        ".env",
        "secret",
        "password",
        "credentials",
        "api_key",
        "private_key",
        ".aws/",
        ".ssh/",
    ],
    CRITICAL_PATTERNS: [
        "rm -rf",
        "sudo",
        "chmod 777",
        "--force",
    ],
} as const;

type RiskLevel = "L0" | "L1" | "L2" | "L3";

interface RiskAssessment {
    level: RiskLevel;
    triggers: string[];
    isSensitive: boolean;
    isCritical: boolean;
}
```

### 4.3 风险评估实现

```typescript
import { RISK_MATRIX, type RiskLevel, type RiskAssessment } from "./risk-matrix.js";

function assessRiskLevel(
    messages: AgentMessage[],
    state: CourtState
): RiskAssessment {
    const toolCalls = messages
        .filter(m => m.role === "assistant" && m.toolCalls)
        .flatMap(m => m.toolCalls || []);

    const triggers: string[] = [];
    let isSensitive = false;
    let isCritical = false;

    for (const call of toolCalls) {
        const name = call.name;

        if (name === "bash") {
            const args = call.input?.command || "";
            
            for (const pattern of RISK_MATRIX.CRITICAL_PATTERNS) {
                if (args.includes(pattern)) {
                    isCritical = true;
                    triggers.push(`critical: ${pattern}`);
                }
            }

            for (const pattern of RISK_MATRIX.SENSITIVE_PATTERNS) {
                if (args.includes(pattern)) {
                    isSensitive = true;
                    triggers.push(`sensitive: ${pattern}`);
                }
            }

            triggers.push("bash");
            continue;
        }

        if (name.startsWith("mcp_")) {
            triggers.push("mcp");
            isSensitive = true;
            continue;
        }

        if (RISK_MATRIX.HIGH_RISK.some(p => 
            p === name || (p.endsWith("*") && name.startsWith(p.slice(0, -1)))
        )) {
            triggers.push(name);
            isSensitive = true;
            continue;
        }

        if (RISK_MATRIX.MED_RISK.includes(name)) {
            triggers.push(name);
            continue;
        }

        if (RISK_MATRIX.LOW_RISK.includes(name)) {
            continue;
        }
    }

    let level: RiskLevel = "L0";
    
    if (isCritical) {
        level = "L2";
    } else if (isSensitive || triggers.some(t => t === "bash" || t === "mcp")) {
        level = "L2";
    } else if (triggers.length > 0) {
        level = "L1";
    }

    if (toolCalls.length === 0) {
        level = "L0";
    }

    return { level, triggers, isSensitive, isCritical };
}
```

### 4.4 史官触发器实现

```typescript
import { spawn, type ChildProcess } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { RiskLevel } from "./risk-matrix.js";
import type { FactPacket } from "./fact-packet.js";

interface HistorianResult {
    advice: string | null;
    record: unknown | null;
    riskFlags: Array<{ id: string; description: string }>;
}

const HISTORIAN_TIMEOUTS: Record<RiskLevel, number> = {
    L0: 0,
    L1: 30000,
    L2: 60000,
    L3: 120000,
};

export async function runHistorian(
    factPacket: FactPacket,
    riskLevel: RiskLevel,
    pi: ExtensionAPI,
    ctx: ExtensionContext
): Promise<HistorianResult> {
    if (riskLevel === "L0") {
        return { advice: null, record: null, riskFlags: [] };
    }

    const isAsync = riskLevel === "L1";
    const timeout = HISTORIAN_TIMEOUTS[riskLevel];

    const factPacketPath = await writeFactPacket(factPacket);

    const args = [
        "--mode", "json",
        "--no-session",
        "--tools", "read",
        "--append-system-prompt", resolveHistorianPrompt(),
        "-p", buildHistorianTask(factPacketPath, riskLevel),
    ];

    if (isAsync) {
        spawnHistorianAsync(args, ctx, factPacketPath);
        
        return {
            advice: null,
            record: {
                type: "async-review",
                factPacketSeq: factPacket.seq,
                riskLevel,
                queuedAt: Date.now(),
            },
            riskFlags: [],
        };
    }

    try {
        const result = await runHistorianProcess(args, ctx, timeout);
        return parseHistorianOutput(result);
    } catch (error) {
        return {
            advice: "审查超时，已允许操作继续。",
            record: {
                type: "timeout",
                factPacketSeq: factPacket.seq,
                riskLevel,
                error: String(error),
            },
            riskFlags: [],
        };
    }
}

async function runHistorianProcess(
    args: string[],
    ctx: ExtensionContext,
    timeout: number
): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn("pi", args, {
            cwd: ctx.cwd,
            env: {
                ...process.env,
                PI_COURT_ROLE: "historian",
            },
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => {
            stdout += data.toString();
        });

        proc.stderr?.on("data", (data) => {
            stderr += data.toString();
        });

        const timer = timeout > 0 ? setTimeout(() => {
            proc.kill("SIGTERM");
            reject(new Error(`Historian timeout after ${timeout}ms`));
        }, timeout) : null;

        proc.on("close", (code) => {
            if (timer) {
                clearTimeout(timer);
            }
            
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`Historian exited with code ${code}: ${stderr}`));
            }
        });
    });
}

function parseHistorianOutput(output: string): HistorianResult {
    const trimmed = output.trim();
    
    try {
        const parsed = JSON.parse(trimmed);
        return {
            advice: parsed.advice || null,
            record: parsed.record || null,
            riskFlags: parsed.riskFlags || [],
        };
    } catch {
        return {
            advice: trimmed.slice(0, 500),
            record: { raw: trimmed, parsed: false },
            riskFlags: [],
        };
    }
}

async function writeFactPacket(packet: FactPacket): Promise<string> {
    const packetsDir = path.join(process.cwd(), ".court", "packets");
    await fs.mkdir(packetsDir, { recursive: true });
    
    const filename = `fact_${packet.seq}.json`;
    const filepath = path.join(packetsDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(packet, null, 2));
    return filepath;
}

function buildHistorianTask(factPacketPath: string, riskLevel: RiskLevel): string {
    return `
你是史官，负责审查丞相的操作。
fact_packet: ${factPacketPath}
risk_level: ${riskLevel}

请读取事实包文件，分析操作风险，输出 JSON 格式建议:
{
  "advice": "给丞相的建议（可为空）",
  "record": "记录摘要",
  "riskFlags": [{"id": "risk-1", "description": "风险描述"}]
}
`;
}
```

## 5. 机械提取事实包

### 5.1 设计原理

修订版架构的核心原则是监督依据独立于被监督者。事实包由父进程代码机械提取，严禁调用 LLM 生成摘要。信息包括工具调用统计、git diff 统计、最后 assistant 消息截取、context.md 快照和 delegation tree。

### 5.2 事实包类型定义

```typescript
interface FactPacket {
    seq: number;
    meta: {
        duration_ms: number;
        turn_id: number;
        git_ref: string;
        risk_level: RiskLevel;
    };
    facts: {
        tool_calls: Array<{
            name: string;
            path?: string;
            status: "success" | "error" | "interrupted";
            duration_ms?: number;
        }>;
        git_diff_stat: string;
        final_statement: string;
    };
    context_snapshot: {
        active_concerns: string[];
        recent_experiences: string[];
    };
    delegation_tree: ObjectiveNode[];
}

interface ObjectiveNode {
    taskId: string;
    parentId: string | null;
    role: "minister" | "worker";
    metrics: {
        toolCallCount: number;
        toolsUsed: string[];
        hasWriteOperation: boolean;
        exitStatus: "success" | "error" | "interrupted";
        durationMs: number;
        tokenUsage?: number;
    };
    selfReport: {
        summary: string;
        confidence: "high" | "medium" | "low";
        anomalies: string[];
    };
    rawLogPath?: string;
    children: ObjectiveNode[];
}
```

### 5.3 事实包构建实现

```typescript
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FactPacket, ObjectiveNode } from "./types.js";
import type { CourtState } from "./state.js";

let packetSequence = 0;

export function buildFactPacket(
    messages: AgentMessage[],
    ctx: ExtensionContext,
    state: CourtState
): FactPacket {
    const seq = ++packetSequence;
    const turnId = state.incrementTurnId();
    
    const toolCalls = extractToolCalls(messages);
    const gitDiffStat = extractGitDiffStat();
    const finalStatement = extractFinalStatement(messages);
    const contextSnapshot = extractContextSnapshot(state);
    const delegationTree = extractDelegationTree(messages, state);

    return {
        seq,
        meta: {
            duration_ms: Date.now() - state.getTurnStartTime(),
            turn_id: turnId,
            git_ref: getCurrentGitRef(),
            risk_level: state.getCurrentRiskLevel(),
        },
        facts: {
            tool_calls: toolCalls,
            git_diff_stat: gitDiffStat,
            final_statement: finalStatement,
        },
        context_snapshot: contextSnapshot,
        delegation_tree: delegationTree,
    };
}

function extractToolCalls(messages: AgentMessage[]): FactPacket["facts"]["tool_calls"] {
    const calls: FactPacket["facts"]["tool_calls"] = [];

    for (const msg of messages) {
        if (msg.role === "assistant" && msg.toolCalls) {
            for (const call of msg.toolCalls) {
                const result = messages.find(m => 
                    m.toolCallId === call.id || 
                    (m as any).tool_call_id === call.id
                );

                let status: "success" | "error" | "interrupted" = "success";
                
                if (result) {
                    const content = typeof result.content === "string" 
                        ? result.content 
                        : JSON.stringify(result.content);
                    
                    if (content.includes("error") || content.includes("Error")) {
                        status = "error";
                    }
                }

                let toolPath: string | undefined;
                
                if (call.name === "read_file" || 
                    call.name === "write_file" || 
                    call.name === "edit_file") {
                    toolPath = call.input?.file_path || call.input?.path;
                } else if (call.name === "bash") {
                    toolPath = call.input?.command?.slice(0, 100);
                } else if (call.name === "delegate") {
                    toolPath = call.input?.task?.slice(0, 100);
                }

                calls.push({
                    name: call.name,
                    path: toolPath,
                    status,
                });
            }
        }
    }

    return calls;
}

function extractGitDiffStat(): string {
    try {
        const output = execSync("git diff --stat HEAD~1 HEAD 2>/dev/null || git diff --stat", {
            encoding: "utf-8",
            timeout: 5000,
            cwd: process.cwd(),
        });
        return output.slice(0, 500);
    } catch {
        return "";
    }
}

function extractFinalStatement(messages: AgentMessage[]): string {
    const lastAssistant = messages
        .filter(m => m.role === "assistant")
        .pop();

    if (!lastAssistant) {
        return "";
    }

    const content = lastAssistant.content || "";
    const thinking = (lastAssistant as any).thinking || "";

    const combined = thinking + content;
    
    if (combined.length <= 200) {
        return combined;
    }

    return combined.slice(0, 200) + "...(truncated)";
}

function extractContextSnapshot(
    state: CourtState
): FactPacket["context_snapshot"] {
    return {
        active_concerns: state.getActiveConcerns(),
        recent_experiences: state.getRecentExperiences(),
    };
}

function extractDelegationTree(
    messages: AgentMessage[],
    state: CourtState
): ObjectiveNode[] {
    const nodes = state.getObjectiveNodes();
    return nodes;
}

function getCurrentGitRef(): string {
    try {
        const hash = execSync("git rev-parse HEAD", {
            encoding: "utf-8",
            timeout: 5000,
        }).trim();
        return hash.slice(0, 7);
    } catch {
        return "unknown";
    }
}
```

## 6. ObjectiveNode 元数据提取

### 6.1 设计原理

每个 delegate进程 子完成时，平台代码自动提取客观元数据。这些数据由代码生成，不依赖 LLM 自述。双层监督机制允许史官先快速扫描元数据发现异常，再按需读取详细日志。

### 6.2 元数据提取实现

```typescript
import type { AgentMessage, ToolResultMessage } from "@mariozechner/pi-agent-core";
import type { ObjectiveNode } from "./types.js";

export function extractObjectiveNode(
    taskId: string,
    parentId: string | null,
    role: "minister" | "worker",
    messages: AgentMessage[],
    startTime: number,
    endTime: number
): ObjectiveNode {
    const toolCalls = messages
        .filter(m => m.role === "assistant" && m.toolCalls)
        .flatMap(m => m.toolCalls || []);

    const toolsUsed = [...new Set(toolCalls.map(t => t.name))];
    const hasWriteOperation = toolCalls.some(t =>
        t.name === "write_file" ||
        t.name === "edit_file" ||
        t.name === "delete_file" ||
        t.name === "bash"
    );

    const errorMessages = messages.filter(m => {
        if (m.role !== "tool") return false;
        const content = typeof m.content === "string" ? m.content : "";
        return content.toLowerCase().includes("error");
    });

    const exitStatus: "success" | "error" | "interrupted" = 
        errorMessages.length > 0 ? "error" : "success";

    const lastAssistant = messages
        .filter(m => m.role === "assistant")
        .pop();

    let summary = "";
    let confidence: "high" | "medium" | "low" = "medium";
    const anomalies: string[] = [];

    if (lastAssistant) {
        const content = lastAssistant.content || "";
        const lines = content.split("\n").filter(l => l.trim());
        
        if (lines.length > 0 && lines[0].length < 200) {
            summary = lines.slice(0, 3).join(" ");
        } else {
            summary = content.slice(0, 200);
        }
    }

    const durationMs = endTime - startTime;
    if (durationMs < 1000 && toolCalls.length > 5) {
        anomalies.push("执行时间异常短");
        confidence = "low";
    }

    if (role === "worker" && !hasWriteOperation) {
        anomalies.push("Worker 无写操作");
        confidence = "low";
    }

    if (toolCalls.length === 0) {
        anomalies.push("无工具调用");
        confidence = "low";
    }

    return {
        taskId,
        parentId,
        role,
        metrics: {
            toolCallCount: toolCalls.length,
            toolsUsed,
            hasWriteOperation,
            exitStatus,
            durationMs,
        },
        selfReport: {
            summary,
            confidence,
            anomalies,
        },
    };
}

export function extractDelegationTree(
    messages: AgentMessage[]
): ObjectiveNode[] {
    const nodes: ObjectiveNode[] = [];
    const delegateResults: Map<string, AgentMessage[]> = new Map();

    let currentDelegate: string | null = null;
    const delegateMessages: AgentMessage[] = [];

    for (const msg of messages) {
        if (msg.role === "assistant" && msg.toolCalls) {
            for (const call of msg.toolCalls) {
                if (call.name === "delegate") {
                    if (currentDelegate) {
                        delegateResults.set(currentDelegate, [...delegateMessages]);
                        delegateMessages.length = 0;
                    }
                    currentDelegate = call.input?.task || call.id;
                }
            }
        }
        
        if (currentDelegate) {
            delegateMessages.push(msg);
        }
    }

    if (currentDelegate) {
        delegateResults.set(currentDelegate, delegateMessages);
    }

    for (const [taskId, msgs] of delegateResults) {
        if (msgs.length === 0) continue;

        const firstMsg = msgs[0];
        const lastMsg = msgs[msgs.length - 1];

        const node = extractObjectiveNode(
            taskId,
            null,
            "minister",
            msgs,
            (firstMsg as any).timestamp || Date.now() - 60000,
            (lastMsg as any).timestamp || Date.now()
        );

        nodes.push(node);
    }

    return nodes;
}
```

### 6.3 异常检测与按需深挖

```typescript
export function detectAnomalies(nodes: ObjectiveNode[]): ObjectiveNode[] {
    const anomalies: ObjectiveNode[] = [];

    for (const node of nodes) {
        const m = node.metrics;
        
        if (m.exitStatus === "error") {
            anomalies.push(node);
            continue;
        }

        if (m.toolCallCount === 0) {
            anomalies.push(node);
            continue;
        }

        if (node.role === "worker" && !m.hasWriteOperation) {
            anomalies.push(node);
            continue;
        }

        if (m.durationMs < 500 && m.toolCallCount > 3) {
            anomalies.push(node);
            continue;
        }

        if (node.selfReport.confidence === "low") {
            anomalies.push(node);
            continue;
        }
    }

    return anomalies;
}
```

## 7. Manifest-Driven Clerk 实现

### 7.1 设计原理

书记官不是独立 Agent，而是声明式清单加上 Hook 机械执法。丞相在任务初始化时生成 `court-manifest.json`，定义各阶段的工具白名单和 Skill 摘要。Hook 在每轮根据清单设置工具白名单，并通过 `context` 事件全量替换 System Messages。

### 7.2 Manifest 类型定义

```typescript
interface CourtManifest {
    task_id: string;
    phases: {
        current: string;
        definitions: Record<string, PhaseDefinition>;
    };
    global_rules: string[];
}

interface PhaseDefinition {
    allowed_tools: string[];
    skill_summaries?: Record<string, string>;
    mcp_visibility?: string[];
}

interface ManifestSnapshot {
    manifest: CourtManifest;
    loadedAt: number;
}
```

### 7.3 Manifest 管理器实现

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CourtManifest, PhaseDefinition } from "./types.js";
import type { CourtState } from "./state.js";

export class ManifestClerk {
    private pi: ExtensionAPI;
    private state: CourtState;
    private manifest: CourtManifest | null = null;
    private manifestPath: string;

    constructor(pi: ExtensionAPI, state: CourtState) {
        this.pi = pi;
        this.state = state;
        this.manifestPath = path.join(process.cwd(), ".court", "manifest.json");
    }

    async loadOrCreateManifest(): Promise<CourtManifest> {
        try {
            const content = await fs.readFile(this.manifestPath, "utf-8");
            this.manifest = JSON.parse(content);
        } catch {
            this.manifest = this.createDefaultManifest();
            await this.saveManifest();
        }

        return this.manifest!;
    }

    private createDefaultManifest(): CourtManifest {
        return {
            task_id: `task-${Date.now()}`,
            phases: {
                current: "analysis",
                definitions: {
                    analysis: {
                        allowed_tools: ["read", "delegate", "search_code", "grep", "glob"],
                        skill_summaries: {
                            "code-analyzer": "只读分析代码结构",
                        },
                    },
                    implementation: {
                        allowed_tools: ["read", "write", "edit", "bash", "delegate"],
                        skill_summaries: {
                            "test-runner": "运行测试验证实现",
                        },
                        mcp_visibility: ["mcp:git"],
                    },
                    review: {
                        allowed_tools: ["read", "delegate", "grep", "bash"],
                        skill_summaries: {
                            "code-review": "审查代码质量",
                        },
                    },
                },
            },
            global_rules: [
                "禁止访问外网",
                "禁止提交 secrets 到 git",
            ],
        };
    }

    async saveManifest(): Promise<void> {
        if (!this.manifest) return;

        const dir = path.dirname(this.manifestPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    }

    getCurrentPhase(): PhaseDefinition {
        if (!this.manifest) {
            return { allowed_tools: ["read", "delegate"] };
        }

        const phaseName = this.manifest.phases.current;
        return this.manifest.phases.definitions[phaseName] || 
               { allowed_tools: ["read", "delegate"] };
    }

    getCurrentTools(): string[] {
        return this.getCurrentPhase().allowed_tools;
    }

    switchPhase(phaseName: string): void {
        if (!this.manifest) return;

        if (!(phaseName in this.manifest.phases.definitions)) {
            throw new Error(`Unknown phase: ${phaseName}`);
        }

        this.manifest.phases.current = phaseName;
        this.saveManifest();
    }

    getCurrentManifest(): CourtManifest {
        return this.manifest || this.createDefaultManifest();
    }

    getSystemPromptReplacement(): string {
        const phase = this.getCurrentPhase();
        const manifest = this.getCurrentManifest();

        let prompt = `## 当前阶段: ${manifest.phases.current}\n\n`;
        prompt += `### 可用工具\n${phase.allowed_tools.join(", ")}\n\n`;

        if (phase.skill_summaries) {
            prompt += `### 可用技能\n`;
            for (const [name, desc] of Object.entries(phase.skill_summaries)) {
                prompt += `- ${name}: ${desc}\n`;
            }
            prompt += "\n";
        }

        if (manifest.global_rules.length > 0) {
            prompt += `### 全局规则\n`;
            for (const rule of manifest.global_rules) {
                prompt += `- ${rule}\n`;
            }
        }

        return prompt;
    }
}
```

### 7.4 Context 事件集成

```typescript
pi.on("context", async (event, _ctx) => {
    const messages = event.messages;
    const clerk = state.getManifestClerk();

    const filtered = state.filterContext(messages, cal);
    const systemReplacement = clerk.getSystemPromptReplacement();

    return {
        messages: filtered,
        prependMessages: [{
            role: "system",
            content: systemReplacement,
        }],
    };
});

pi.on("before_agent_start", async (event, ctx) => {
    const clerk = state.getManifestClerk();
    const tools = clerk.getCurrentTools();
    
    pi.setActiveTools(tools);

    const manifest = clerk.getCurrentManifest();
    const phase = clerk.getCurrentPhase();

    let prompt = `你是丞相。当前阶段: ${manifest.phases.current}\n`;
    prompt += `可用工具: ${phase.allowed_tools.join(", ")}\n\n`;

    const lastAdvice = state.getLastHistorianAdvice();
    if (lastAdvice) {
        prompt += `## 史官进言\n${lastAdvice}\n\n`;
    }

    const risks = cal.getAnchorsByType("RISK_HIGH");
    if (risks.length > 0) {
        prompt += `## 风险警告\n`;
        for (const r of risks) {
            prompt += `- [${r.id}] ${r.content}\n`;
        }
    }

    return { systemPrompt: prompt };
});
```

## 8. 完整事件时序

### 8.1 标准用户请求流程

```
用户输入
  │
  ▼
[session_start 事件]
  ├── 加载或创建 Court Manifest
  ├── 初始化 CAL 锚点账本
  └── 设置初始工具白名单 (read, delegate)
  │
  ▼
[before_agent_start 事件]
  ├── 获取当前阶段的工具白名单
  ├── pi.setActiveTools(白名单)
  ├── 构建 System Prompt:
  │   ├── 丞相角色定义
  │   ├── 当前阶段信息
  │   ├── 史官进言 (如有)
  │   └── 风险警告 (如有)
  └── 返回 systemPrompt 注入
  │
  ▼
丞相 Agent 循环开始
  │
  ├── [context 事件] (每次 LLM 调用前)
  │     ├── 过滤已完成任务的消息
  │     ├── 移除过期的史官建议
  │     ├── 注入风险警告到顶部
  │     └── 全量替换 System Messages
  │
  ├── 丞相分析任务
  │     │
  │     ├── 调用 delegate (role: "minister")
  │     │     │
  │     │     ├── spawn 子进程 (PI_COURT_ROLE=minister)
  │     │     ├── 加载 manifest 限定的工具
  │     │     ├── --append-system-prompt 注入角色
  │     │     │
  │     │     ├── 九卿执行
  │     │     │     │
  │     │     │     ├── 可能继续 delegate (role: "worker")
  │     │     │     │     │
  │     │     │     │     ├── spawn worker 子进程
  │     │     │     │     ├── 加载 manifest 工具
  │     │     │     │     ├── 执行原子任务
  │     │     │     │     └── 返回 JSON 结果
  │     │     │     │
  │     │     │     └── 返回九卿汇总结果
  │     │     │
  │     │     └── 提取 ObjectiveNode 元数据
  │     │
  │     └── 汇总结果给用户
  │
  └── Agent 循环结束
  │
  ▼
[agent_end 事件]
  ├── 提取 Fact Packet:
  │     ├── 遍历 tool_calls
  │     ├── git diff --stat
  │     ├── 截取最后 Assistant 消息
  │     ├── context 快照
  │     └── delegation tree (ObjectiveNode 树)
  │
  ├── 风险矩阵评估:
  │     ├── 检查工具调用类型
  │     ├── 检查敏感模式
  │     └── 输出 RiskLevel (L0/L1/L2/L3)
  │
  ├── L0: 直接返回 (跳过史官)
  │
  ├── L1: 异步史官
  │     ├── spawn 史官子进程 (后台)
  │     ├── 记录 async-review 到 CAL
  │     └── 不阻塞用户
  │
  ├── L2: 同步史官
  │     ├── spawn 史官子进程 (阻塞, 60s 超时)
  │     ├── 解析 JSON 输出
  │     ├── advice → pi.sendMessage (nextTurn)
  │     ├── record → appendEntry (持久化)
  │     └── riskFlags → CAL.addAnchor (RISK_HIGH)
  │
  └── L3: 终局深审 (session_before_compact)
        ├── 在压缩前触发
        ├── 深度审查所有历史
        └── 输出综合建议
  │
  ▼
[context 事件] (下一轮开始前)
  ├── CAL.checkResolutionSignal() 清除已解决的风险
  ├── 过滤消息 (替换已完成任务为摘要)
  ├── 注入活跃风险警告
  └── 全量替换 System Messages (Manifest)
  │
  ▼
用户看到丞相回复
  ├── 可用 /court-status 查看状态
  ├── 可用 /court-manifest 查看/切换阶段
  └── 输入下一条指令 → 回到顶部
```

### 8.2 关键事件映射表

| 事件 | 功能 | 访问资源 | 输出 |
|------|------|----------|------|
| `session_start` | 初始化 | Manifest 文件 | setActiveTools |
| `before_agent_start` | 角色注入 | CAL + Manifest | systemPrompt |
| `context` | 上下文过滤 | CAL + Messages | filtered messages |
| `agent_end` | 史官触发 | Messages + State | sendMessage + appendEntry |
| `session_before_compact` | 终局深审 | 全部历史 | CompactionResult |

## 9. 文件结构

```
.court/                              # 朝廷工作目录
├── manifest.json                    # Court Manifest (声明式清单)
├── cal.json                         # CAL 锚点账本快照
├── cursor.json                      # 游标状态 (seq + git_ref)
├── packets/                         # 机械提取事实包
│   ├── fact_0001.json
│   ├── fact_0002.json
│   └── ...
├── logs/                            # ObjectiveNode 执行日志
│   └── {session_id}.jsonl
└── context.md                       # 项目记忆

extension/                           # Pi Extension 目录
├── index.ts                        # 入口 (角色路由 + 事件注册)
├── types.ts                        # 类型定义
├── state.ts                        # 运行时状态管理
├── cal.ts                          # CAL 锚点账本管理器
├── manifest.ts                     # Manifest-Driven Clerk
├── historian.ts                     # 史官触发 + Fact Packet 构建
├── delegate.ts                     # delegate 工具定义
├── risk-matrix.ts                  # 风险分级矩阵
├── objective-node.ts               # ObjectiveNode 提取
└── fact-packet.ts                 # 机械提取实现

prompts/
├── historian.md                    # 史官 prompt (用户可编辑)
└── agents/
    ├── architect.md               # 九卿: 架构师
    ├── coder.md                   # 九卿: 编码者
    ├── reviewer.md                # 九卿: 审查员
    └── researcher.md              # 执行层: 调研员
```

## 10. API 映射总结

| 机制 | Pi Extension API | 用法 |
|------|-------------------|------|
| 角色路由 | 环境变量 `PI_COURT_ROLE` | 进程启动时判定 |
| 工具限制 | `setActiveTools(names)` | session_start / before_agent_start |
| 上下文注入 | `context` 事件 + `prependMessages` | 全量替换 System Messages |
| 史官触发 | `agent_end` 事件 | 风险评估后 spawn |
| 建议注入 | `sendMessage({ deliverAs: "nextTurn" })` | 注入下一轮对话 |
| 持久化 | `appendEntry(type, data)` | CAL + 史官记录 |
| 压缩拦截 | `session_before_compact` 事件 | 终局深审 |
| 状态管理 | `getEntries(type)` | 加载历史锚点 |
| 工具定义 | `registerTool(tool)` | delegate 工具 |
| 命令注册 | `registerCommand(name, def)` | /court-status 等 |

## 11. 降级策略

如果 Pi Extension 不可用，实现可以降级到以下方案:

| 能力 | 完整实现 | 降级方案 |
|------|----------|----------|
| 上下文替换 | context 事件 | 简化为在 before_agent_start 注入摘要 |
| 工具限制 | setActiveTools | PreToolUse 拦截 + deny |
| 同步审查 | agent_end 阻塞 | Stop hook 模拟 |
| 异步审查 | spawn 子进程 | Sub-Agent 机制 |
| 持久化 | appendEntry | 文件系统直接写入 |

修订版朝廷架构通过这套实现设计，在保证安全性的同时兼顾了用户体验。分级闸门模型确保低风险操作的流畅性，机械提取事实包保证了审查的客观性，Manifest-Driven Clerk 实现了声明式的工具生命周期管理。
