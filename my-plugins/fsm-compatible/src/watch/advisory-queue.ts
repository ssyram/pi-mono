import { randomUUID } from "node:crypto";
import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

export interface AdvisoryDelivery {
	readonly deliveryId: string;
	readonly targetSessionId: string;
	readonly text: string;
	readonly at: number;
	state: "accepted" | "scheduled" | "consumed" | "failed";
}

/** Session-owned bounded Watcher receiver queue. 204 semantics only mean accepted. */
export class AdvisoryQueue {
	private readonly items: AdvisoryDelivery[] = [];
	private closed = false;
	private readonly capacity: number;

	constructor(capacity: number) {
		this.capacity = capacity;
		if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RuntimeError("protocol-invalid");
	}

	accept(targetSessionId: string, body: unknown): AdvisoryDelivery {
		if (this.closed) throw new RuntimeError("owner-unavailable");
		if (!isAdmissionObject(body) || !Array.isArray(body.parts)) throw new RuntimeError("protocol-invalid");
		const texts: string[] = [];
		for (const part of body.parts) {
			if (!isAdmissionObject(part) || part.type !== "text" || typeof part.text !== "string") throw new RuntimeError("protocol-invalid");
			texts.push(part.text);
		}
		if (this.items.length >= this.capacity) throw new RuntimeError("queue-full");
		const delivery: AdvisoryDelivery = { deliveryId: randomUUID(), targetSessionId, text: texts.join("\n"),
			at: Date.now(), state: "accepted" };
		this.items.push(delivery);
		return delivery;
	}

	peek(): AdvisoryDelivery | undefined { return this.items[0]; }

	markScheduled(deliveryId: string): void {
		const item = this.items.find((entry) => entry.deliveryId === deliveryId);
		if (!item || item.state !== "accepted") throw new RuntimeError("not-ready");
		item.state = "scheduled";
	}

	markConsumed(deliveryId: string): void {
		const item = this.items.find((entry) => entry.deliveryId === deliveryId);
		if (!item) throw new RuntimeError("not-ready");
		item.state = "consumed";
		this.evict(deliveryId);
	}

	markFailed(deliveryId: string): void {
		const item = this.items.find((entry) => entry.deliveryId === deliveryId);
		if (!item) return;
		item.state = "failed";
		this.evict(deliveryId);
	}

	remove(deliveryId: string): void { this.evict(deliveryId); }

	snapshot(): readonly AdvisoryDelivery[] { return [...this.items]; }

	failAll(): void {
		for (const item of this.items) item.state = "failed";
	}

	close(): void { this.closed = true; this.failAll(); }

	private evict(deliveryId: string): void {
		const index = this.items.findIndex((entry) => entry.deliveryId === deliveryId);
		if (index >= 0) this.items.splice(index, 1);
	}
}
