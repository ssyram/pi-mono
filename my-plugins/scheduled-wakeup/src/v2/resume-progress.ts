import type { ExecutionProgress, TaskSchedule } from "./model.js";

export function resumeProgress(progress: ExecutionProgress, schedule: TaskSchedule, now: number): ExecutionProgress {
	if (progress.status !== "active") return progress;
	if (schedule.kind === "once" && progress.nextRunAt < now) {
		return progress.lastRunAt === undefined
			? { status: "expired", runCount: progress.runCount, expiredAt: now }
			: { status: "expired", runCount: progress.runCount, expiredAt: now, lastRunAt: progress.lastRunAt };
	}
	if (progress.suspendedAt === undefined) return progress;
	const { suspendedAt, ...running } = progress;
	if (schedule.kind === "once") return running;
	const nextRunAt = now + Math.max(0, progress.nextRunAt - suspendedAt);
	if (!Number.isSafeInteger(nextRunAt) || nextRunAt <= 0) throw new Error("Resumed next run time exceeds the safe integer range");
	return { ...running, nextRunAt };
}
