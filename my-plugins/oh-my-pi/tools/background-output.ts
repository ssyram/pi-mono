/**
 * background_output tool — inspect the output/result of a background job.
 *
 * Since the ConcurrencyManager's Job type does not carry intermediate session
 * messages (only a final `result` string), this tool surfaces whatever is
 * available: the result for completed jobs, or a "still running" notice
 * otherwise. An optional `block` flag lets the caller poll until the job
 * finishes (up to 60 s).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

import type { ConcurrencyManager, Job } from "./concurrency.js";
import { formatTimestamp, formatDuration } from "./format-utils.js";

// ─── Parameter schema ────────────────────────────────────────────────────────

const BackgroundOutputParams = Type.Object({
	jobId: Type.String({ description: "Background job ID" }),
	mode: Type.Optional(
		StringEnum(["summary", "full", "latest"] as const, {
			description:
				'Output mode. "summary" (default): status + result preview. ' +
				'"full": complete result text (paginated). ' +
				'"latest": tail of the result.',
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Max characters to return for full/latest modes (default 4000)",
		}),
	),
	since: Type.Optional(
		Type.Number({
			description: "Character offset into the result — returns content after this position (full mode only)",
		}),
	),
	block: Type.Optional(
		Type.Boolean({
			description: "If true and job is still running, wait up to 60 s for completion before responding",
		}),
	),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a job to leave the running/queued state, polling every 2 s up to maxMs. */
async function waitForCompletion(
	concurrency: ConcurrencyManager,
	jobId: string,
	maxMs: number,
): Promise<Job | undefined> {
	const deadline = Date.now() + maxMs;
	let job = concurrency.getStatus(jobId);
	while (job && (job.status === "running" || job.status === "queued") && Date.now() < deadline) {
		await sleep(2000);
		job = concurrency.getStatus(jobId);
	}
	return job;
}

// ─── Build output text ──────────────────────────────────────────────────────

function buildSummary(job: Job): string {
	const lines: string[] = [
		`Job:     ${job.id}`,
		`Status:  ${job.status}`,
		`Agent:   ${job.agent}`,
		`Model:   ${job.model}`,
		`Created: ${formatTimestamp(job.createdAt)}`,
	];

	if (job.startedAt) {
		lines.push(`Started: ${formatTimestamp(job.startedAt)}`);
		lines.push(`Elapsed: ${formatDuration(job.startedAt)}`);
	}

	if (job.result) {
		const preview = job.result.length > 800 ? job.result.slice(0, 800) + "\n...(truncated)" : job.result;
		lines.push("", "--- Result (preview) ---", preview);
	}

	if (job.error) {
		lines.push("", `Error: ${job.error}`);
	}

	if (job.status === "running" || job.status === "queued") {
		lines.push("", "Job is still in progress. Use block=true to wait, or check back later.");
	}

	return lines.join("\n");
}

function buildFull(job: Job, limit: number, since: number): string {
	if (!job.result && !job.error) {
		if (job.status === "running" || job.status === "queued") {
			return `Job ${job.id} is still ${job.status}. No output available yet.`;
		}
		return `Job ${job.id} completed with no output.`;
	}

	const source = job.result ?? job.error ?? "";
	const slice = source.slice(since, since + limit);
	const remaining = source.length - since - slice.length;

	const header =
		`[${job.status}] ${job.agent} (${job.model}) — ` +
		`chars ${since}–${since + slice.length} of ${source.length}` +
		(remaining > 0 ? ` (${remaining} more)` : "");

	return header + "\n\n" + slice;
}

function buildLatest(job: Job, limit: number): string {
	if (!job.result && !job.error) {
		if (job.status === "running" || job.status === "queued") {
			return `Job ${job.id} is still ${job.status}. No output available yet.`;
		}
		return `Job ${job.id} completed with no output.`;
	}

	const source = job.result ?? job.error ?? "";
	const tail = source.slice(-limit);
	const skipped = source.length - tail.length;
	const header =
		`[${job.status}] ${job.agent} (${job.model}) — ` +
		`last ${tail.length} chars` +
		(skipped > 0 ? ` (${skipped} earlier chars omitted)` : "");

	return header + "\n\n" + tail;
}

// ─── Details type ────────────────────────────────────────────────────────────

interface BackgroundOutputDetails {
	jobId: string;
	status: Job["status"];
	agent: string;
	model: string;
	mode: "summary" | "full" | "latest";
	resultLength: number;
	blocked: boolean;
	error?: string;
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerBackgroundOutput(
	pi: ExtensionAPI,
	concurrency: ConcurrencyManager,
): void {
	pi.registerTool({
		name: "background_output",
		label: "Background Output",
		description:
			"Read the output of a background job. " +
			'Modes: summary — status + result preview; full — paginated result; latest — tail of result. ' +
			"Use block=true to wait up to 60 s for a running job to finish.",
		promptSnippet:
			'background_output(jobId: str, mode?: "summary"|"full"|"latest", limit?: num, since?: num, block?: bool) -> output',
		promptGuidelines: [
			"Use background_output to read the full result of a completed background job.",
			'Use mode="full" with since/limit for paginated reading of large outputs.',
			'Use mode="latest" to see the most recent part of the output.',
			"Set block=true when you need the result now and the job is about to finish.",
			"For just checking job status (without output), use background_task(status, jobId) instead.",
		],
		parameters: BackgroundOutputParams,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const mode = params.mode ?? "summary";
			const limit = params.limit ?? 4000;
			const since = params.since ?? 0;
			const shouldBlock = params.block === true;

			// 1. Fetch the job — optionally waiting for completion
			let job: Job | undefined;

			if (shouldBlock) {
				job = concurrency.getStatus(params.jobId);
				if (job && (job.status === "running" || job.status === "queued")) {
					// Wait up to 60s, but respect abort signal.
					// Use a local AbortController to clean up the abort listener after Promise.race resolves.
					const waitPromise = waitForCompletion(concurrency, params.jobId, 60_000);
					if (signal) {
						const localAc = new AbortController();
						const abortPromise = new Promise<undefined>((resolve) => {
							const onAbort = () => resolve(undefined);
							signal.addEventListener("abort", onAbort, { once: true, signal: localAc.signal });
						});
						try {
							job = await Promise.race([waitPromise, abortPromise]);
						} finally {
							// Clean up: abort the local controller to remove the listener from the parent signal
							localAc.abort();
						}
						if (!job) {
							// Aborted during wait — re-fetch current state
							job = concurrency.getStatus(params.jobId);
						}
					} else {
						job = await waitPromise;
					}
				} else {
					// Already done or not found — no need to block
				}
			} else {
				job = concurrency.getStatus(params.jobId);
			}

			// 2. Job not found
			if (!job) {
				return {
					content: [{ type: "text", text: `Error: job ${params.jobId} not found` }],
					details: {
						jobId: params.jobId,
						status: "error" as const,
						agent: "",
						model: "",
						mode,
						resultLength: 0,
						blocked: shouldBlock,
						error: "not found",
					} as BackgroundOutputDetails,
				};
			}

			// 3. Build output based on mode
			let text: string;
			switch (mode) {
				case "summary":
					text = buildSummary(job);
					break;
				case "full":
					text = buildFull(job, limit, since);
					break;
				case "latest":
					text = buildLatest(job, limit);
					break;
			}

			return {
				content: [{ type: "text", text }],
				details: {
					jobId: job.id,
					status: job.status,
					agent: job.agent,
					model: job.model,
					mode,
					resultLength: (job.result ?? job.error ?? "").length,
					blocked: shouldBlock,
				} as BackgroundOutputDetails,
			};
		},

		renderCall(args, theme, _context) {
			const mode = args.mode ?? "summary";
			let text =
				theme.fg("toolTitle", theme.bold("bg-output ")) +
				theme.fg("accent", args.jobId.slice(0, 8)) +
				" " +
				theme.fg("muted", mode);
			if (args.block) text += theme.fg("warning", " [block]");
			if (args.since) text += theme.fg("dim", ` @${args.since}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded }, theme, _context) {
			const details = result.details as BackgroundOutputDetails | undefined;
			if (!details) {
				const t = result.content[0];
				return new Text(t?.type === "text" ? t.text : "", 0, 0);
			}

			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const statusColor =
				details.status === "completed"
					? "success"
					: details.status === "error"
						? "error"
						: details.status === "running"
							? "accent"
							: "dim";

			let out =
				theme.fg("accent", details.jobId.slice(0, 8)) +
				" " +
				theme.fg(statusColor, details.status) +
				theme.fg("dim", ` ${details.agent} (${details.model})`) +
				theme.fg("muted", ` ${details.resultLength} chars`);

			if (details.blocked) {
				out += theme.fg("warning", " [waited]");
			}

			if (expanded) {
				const t = result.content[0];
				const text = t?.type === "text" ? t.text : "";
				const preview = text.length > 300 ? text.slice(0, 297) + "..." : text;
				out += "\n" + theme.fg("muted", preview);
			}

			return new Text(out, 0, 0);
		},
	});
}
