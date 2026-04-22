/**
 * background_task tool — manage and inspect background jobs.
 *
 * Provides list/status/cancel actions for jobs submitted
 * through the ConcurrencyManager.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { ConcurrencyManager, Job } from "./concurrency.js";
import { formatTimestamp, formatDuration } from "./format-utils.js";

// ─── Parameter schema ────────────────────────────────────────────────────────

const BackgroundTaskParams = Type.Object({
	action: StringEnum(["list", "status", "cancel"] as const, {
		description: "Action to perform on background jobs",
	}),
	jobId: Type.Optional(
		Type.String({ description: "Job ID (required for status/cancel)" }),
	),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatJobSummary(job: Job): string {
	const status = job.status.toUpperCase().padEnd(9);
	const agent = job.agent;
	const model = job.model;
	const id = job.id.slice(0, 8);
	const time = job.startedAt ? formatDuration(job.startedAt) : "queued";
	const taskPreview = job.task.length > 50 ? job.task.slice(0, 47) + "..." : job.task;
	return `[${id}] ${status} ${agent} (${model}) ${time}\n  ${taskPreview}`;
}

function formatJobDetail(job: Job): string {
	const lines: string[] = [
		`Job:      ${job.id}`,
		`Status:   ${job.status}`,
		`Agent:    ${job.agent}`,
		`Model:    ${job.model}`,
		`Created:  ${formatTimestamp(job.createdAt)}`,
	];

	if (job.startedAt) {
		lines.push(`Started:  ${formatTimestamp(job.startedAt)}`);
		lines.push(`Elapsed:  ${formatDuration(job.startedAt)}`);
	}

	lines.push(`Task:     ${job.task}`);

	if (job.result) {
		lines.push("", "--- Result ---", job.result);
	}

	if (job.error) {
		lines.push("", `Error: ${job.error}`);
	}

	return lines.join("\n");
}

// ─── Details type ────────────────────────────────────────────────────────────

interface BackgroundTaskDetails {
	action: "list" | "status" | "cancel";
	jobs?: Job[];
	job?: Job;
	error?: string;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBackgroundTask(
	pi: ExtensionAPI,
	concurrency: ConcurrencyManager,
): void {
	pi.registerTool({
		name: "background_task",
		label: "Background Task",
		description:
			"Manage background agent jobs. " +
			"Actions: list — show all jobs; " +
			"status (jobId) — detailed status of a specific job; " +
			"cancel (jobId) — cancel a queued or running job.",
		promptSnippet:
			'background_task(action: "list"|"status"|"cancel", jobId?: str) -> job_info',
		promptGuidelines: [
			"Use background_task(list) to check on all running and completed background jobs.",
			"Use background_task(status, jobId) to get the result of a completed job or check progress.",
			"Use background_task(cancel, jobId) to stop a job that is no longer needed.",
		],
		parameters: BackgroundTaskParams,

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			switch (params.action) {
				case "list": {
					const jobs = concurrency.list();
					if (jobs.length === 0) {
						return {
							content: [{ type: "text", text: "No background jobs." }],
							details: { action: "list", jobs: [] } as BackgroundTaskDetails,
						};
					}

					const summary = jobs.map(formatJobSummary).join("\n\n");
					const running = jobs.filter((j) => j.status === "running").length;
					const queued = jobs.filter((j) => j.status === "queued").length;
					const completed = jobs.filter((j) => j.status === "completed").length;
					const errors = jobs.filter((j) => j.status === "error").length;

					const header = `${jobs.length} job(s): ${running} running, ${queued} queued, ${completed} completed, ${errors} errors\n\n`;
					return {
						content: [{ type: "text", text: header + summary }],
						details: { action: "list", jobs } as BackgroundTaskDetails,
					};
				}

				case "status": {
					if (!params.jobId) {
						return {
							content: [{ type: "text", text: "Error: jobId is required for status" }],
							details: { action: "status", error: "jobId is required" } as BackgroundTaskDetails,
						};
					}

					const job = concurrency.getStatus(params.jobId);
					if (!job) {
						return {
							content: [{ type: "text", text: `Error: job ${params.jobId} not found` }],
							details: {
								action: "status",
								error: `job ${params.jobId} not found`,
							} as BackgroundTaskDetails,
						};
					}

					if (job.status === "completed" || job.status === "error") {
						concurrency.markViewed(params.jobId);
					}

					return {
						content: [{ type: "text", text: formatJobDetail(job) }],
						details: { action: "status", job } as BackgroundTaskDetails,
					};
				}

				case "cancel": {
					if (!params.jobId) {
						return {
							content: [{ type: "text", text: "Error: jobId is required for cancel" }],
							details: { action: "cancel", error: "jobId is required" } as BackgroundTaskDetails,
						};
					}

					const cancelled = concurrency.cancel(params.jobId);
					if (!cancelled) {
						return {
							content: [
								{
									type: "text",
									text: `Error: job ${params.jobId} not found or already completed`,
								},
							],
							details: {
								action: "cancel",
								error: `job ${params.jobId} not found or already completed`,
							} as BackgroundTaskDetails,
						};
					}

					return {
						content: [{ type: "text", text: `Job ${params.jobId} cancelled.` }],
						details: {
							action: "cancel",
							job: concurrency.getStatus(params.jobId),
						} as BackgroundTaskDetails,
					};
				}
			}
		},

		renderCall(args, theme, _context) {
			let text = theme.fg("toolTitle", theme.bold("bg-task ")) + theme.fg("muted", args.action);
			if (args.jobId) text += ` ${theme.fg("accent", args.jobId.slice(0, 8))}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const raw = result.details;
			const details =
				typeof raw === "object" && raw !== null &&
				typeof (raw as Record<string, unknown>).action === "string"
					? (raw as BackgroundTaskDetails)
					: undefined;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			switch (details.action) {
				case "list": {
					const jobs = details.jobs ?? [];
					if (jobs.length === 0) {
						return new Text(theme.fg("dim", "No background jobs"), 0, 0);
					}

					const running = jobs.filter((j) => j.status === "running").length;
					const queued = jobs.filter((j) => j.status === "queued").length;
					const completed = jobs.filter((j) => j.status === "completed").length;
					const errors = jobs.filter((j) => j.status === "error").length;

					let out = theme.fg("muted", `${jobs.length} job(s): `) +
						theme.fg("accent", `${running} running`) +
						theme.fg("dim", `, ${queued} queued, ${completed} done, ${errors} err`);

					const display = expanded ? jobs : jobs.slice(0, 5);
					for (const job of display) {
						const statusColor =
							job.status === "completed"
								? "success"
								: job.status === "error"
									? "error"
									: job.status === "running"
										? "accent"
										: "dim";
						const icon =
							job.status === "completed"
								? "v"
								: job.status === "error"
									? "!"
									: job.status === "running"
										? ">"
										: ".";
						out +=
							`\n${theme.fg(statusColor, icon)} ` +
							theme.fg("accent", job.id.slice(0, 8)) +
							` ${theme.fg("muted", job.agent)}`;
					}
					if (!expanded && jobs.length > 5) {
						out += `\n${theme.fg("dim", `... ${jobs.length - 5} more`)}`;
					}
					return new Text(out, 0, 0);
				}

				case "status": {
					const job = details.job;
					if (!job) return new Text(theme.fg("dim", "No job data"), 0, 0);

					const statusColor =
						job.status === "completed"
							? "success"
							: job.status === "error"
								? "error"
								: job.status === "running"
									? "accent"
									: "dim";

					let out =
						theme.fg("accent", job.id.slice(0, 8)) +
						" " +
						theme.fg(statusColor, job.status) +
						theme.fg("dim", ` ${job.agent} (${job.model})`);

					if (job.startedAt) {
						out += theme.fg("dim", ` ${formatDuration(job.startedAt)}`);
					}

					if (expanded && job.result) {
						const preview = job.result.length > 200 ? job.result.slice(0, 197) + "..." : job.result;
						out += "\n" + theme.fg("muted", preview);
					}

					if (job.error) {
						out += "\n" + theme.fg("error", job.error);
					}

					return new Text(out, 0, 0);
				}

				case "cancel": {
					const t = result.content[0];
					const msg = t?.type === "text" ? t.text : "";
					return new Text(theme.fg("success", "x ") + theme.fg("muted", msg), 0, 0);
				}

				default: {
					const t = result.content[0];
					return new Text(t?.type === "text" ? (t.text ?? "") : "", 0, 0);
				}
			}
		},
	});
}
