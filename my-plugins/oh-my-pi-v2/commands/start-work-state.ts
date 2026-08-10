import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type WorkStage = "stage1" | "stage2";

export interface WorkState {
	activePlan?: string;
	stage: WorkStage;
	round: number;
	gate1Rejections: number;
	startedAt?: number;
	lastUpdated: number;
}

export const PLAN_DIR = ".pi/oh-my-pi-plans";
export const MAX_GATE1_REJECTIONS = 3;
export const MAX_STAGE2_ROUNDS = 20;
const STATE_FILE = ".pi/oh-my-pi-state.json";

export async function loadWorkState(cwd: string): Promise<WorkState | undefined> {
	try {
		return JSON.parse(await readFile(join(cwd, STATE_FILE), "utf-8")) as WorkState;
	} catch {
		return undefined;
	}
}

export async function saveWorkState(cwd: string, state: WorkState): Promise<void> {
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(join(cwd, STATE_FILE), JSON.stringify(state, null, 2), "utf-8");
}

export async function saveWorkPlan(cwd: string, safeName: string, content: string): Promise<string> {
	await mkdir(join(cwd, PLAN_DIR), { recursive: true });
	const path = join(cwd, PLAN_DIR, `${safeName}.md`);
	await writeFile(path, content, "utf-8");
	return path;
}

export async function loadWorkPlan(cwd: string, safeName: string): Promise<string | undefined> {
	try {
		return await readFile(join(cwd, PLAN_DIR, `${safeName}.md`), "utf-8");
	} catch {
		return undefined;
	}
}

export function makeWorkPlanName(task: string): string {
	return task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}
