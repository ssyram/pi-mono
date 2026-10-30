import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	CANCELLED_FILE,
	DELIVERED_FILE,
} from "../script-tasks/run-record.js";
import type { ExecutionTarget } from "./model.js";
import type { RunCatalog } from "./run-catalog.js";
import type { RunView } from "./run-catalog-state.js";
import {
	boundaryEntry,
	promptDelivery,
	runDelivery,
	sendNow,
	type DeliveryItem,
} from "./delivery-actions.js";

export type DeliveryCoordinator = {
	enqueueRun(view: RunView): void;
	setDeliveryBarrier(taskId: string, on: boolean): void;
	enqueuePrompt(target: ExecutionTarget): void;
	pending(): readonly DeliveryItem[];
	deliveryStatus(): Map<string, { wakeUps: number; noWakes: number }>;
	pump(): void;
	cancelPending(taskId: string): number;
	dispose(): void;
};

export function createDeliveryCoordinator(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	catalog: RunCatalog,
	now: () => number = Date.now,
): DeliveryCoordinator {
	const pending = new Map<string, DeliveryItem>();
	// R5: stop sets a per-task barrier so a completing run cannot be pumped
	// out while its termination is in flight.
	const deliveryBarriers = new Set<string>();
	// E19: boundary deliveries are marked delivered only after the host settled;
	// a crash before that redelivers (at-least-once) instead of losing the message.
	const boundarySent = new Map<string, DeliveryItem>();
	let promptSeq = 0;
	let closed = false;
	const retractable = (item: DeliveryItem): boolean =>
		item.runDir === undefined ||
		(!existsSync(join(item.runDir, CANCELLED_FILE)) &&
			!existsSync(join(item.runDir, DELIVERED_FILE)));
	const deliverIdle = (item: DeliveryItem): boolean => {
		try {
			sendNow(pi, item.render(now()));
		} catch {
			// E32: a failed send keeps the item pending for the next pump.
			return false;
		}
		pending.delete(item.key);
		if (item.runDir !== undefined)
			catalog.markDelivered(item.runDir, "idle-send");
		return true;
	};
	const markBoundaryDelivered = (): void => {
		for (const [key, item] of [...boundarySent]) {
			boundarySent.delete(key);
			if (item.runDir !== undefined)
				catalog.markDelivered(item.runDir, "boundary-entries");
		}
	};
	// Boundary markers must not depend on agent_settled firing: if that event
	// never comes, an unmarked run would be re-delivered by every scan tick.
	// A short timer bounds the window; a crash inside it keeps at-least-once.
	const scheduleBoundaryMarker = (): void => {
		setTimeout(markBoundaryDelivered, 2000).unref?.();
	};
	const pump = (): void => {
		if (closed) return;
		for (const item of [...pending.values()]) {
			if (item.owner && !retractable(item)) pending.delete(item.key);
		}
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;
		for (const item of [...pending.values()]) {
			if (!ctx.isIdle() || ctx.hasPendingMessages()) break;
			if (deliveryBarriers.has(item.taskId)) continue;
			if (!deliverIdle(item)) break;
		}
	};
	const unsubscribeBeforeSettle = pi.on(
		"agent_before_settle",
		(event) => {
			if (closed || event.outcome === "aborted") return undefined;
			const mine = [...pending.values()].filter(
				(item) => item.owner && retractable(item),
			);
			if (mine.length === 0) return undefined;
			const entries = mine.map((item) => boundaryEntry(item.render(now())));
			for (const item of mine) {
				pending.delete(item.key);
				boundarySent.set(item.key, item);
			}
			scheduleBoundaryMarker();
			// exactOptionalPropertyTypes: conditional construction instead of `continue: undefined`
			return mine.some((item) => item.shouldWake)
				? { entries, continue: true }
				: { entries };
		},
	);
	const unsubscribeSettled = pi.on("agent_settled", () => {
		markBoundaryDelivered();
		pump();
	});
	return {
		setDeliveryBarrier(taskId, on) {
			if (on) deliveryBarriers.add(taskId);
			else deliveryBarriers.delete(taskId);
		},
		enqueueRun(view) {
			if (closed || view.state !== "pendingDelivery" || view.outcome === undefined)
				return;
			const key = `run:${view.dir}`;
			// R6: in-flight boundary items are still undelivered; do not requeue.
			if (pending.has(key) || boundarySent.has(key)) return;
			pending.set(key, {
				key,
				taskId: view.taskId,
				runDir: view.dir,
				owner: true,
				shouldWake: view.outcome.shouldWake,
				render: runDelivery(
					view.taskId,
					view.record.payload,
					view.outcome,
				),
			});
			pump();
		},
		enqueuePrompt(target) {
			if (closed || target.prompt === undefined) return;
			promptSeq += 1;
			const key = `prompt:${target.id}:${promptSeq}`;
			pending.set(key, {
				key,
				taskId: target.id,
				runDir: undefined,
				owner: true,
				shouldWake: true,
				render: promptDelivery(
					target.id,
					target.prompt,
					target.includeTimestamp === true,
				),
			});
			pump();
		},
		pending: () => [...pending.values()],
		deliveryStatus() {
			const status = new Map<string, { wakeUps: number; noWakes: number }>();
			for (const item of pending.values()) {
				const current = status.get(item.taskId) ?? { wakeUps: 0, noWakes: 0 };
				if (item.shouldWake) current.wakeUps += 1;
				else current.noWakes += 1;
				status.set(item.taskId, current);
			}
			return status;
		},
		pump,
		cancelPending(taskId) {
			let retracted = 0;
			for (const item of [...pending.values()]) {
				if (item.taskId !== taskId) continue;
				// E20: already-delivered runs are not retractable; leave them done.
				if (!retractable(item)) {
					pending.delete(item.key);
					continue;
				}
				pending.delete(item.key);
				if (item.runDir !== undefined)
					catalog.markCancelled(item.runDir, "pendingDelivery");
				retracted += 1;
			}
			return retracted;
		},
		dispose() {
			closed = true;
			unsubscribeBeforeSettle();
			unsubscribeSettled();
		},
	};
}
