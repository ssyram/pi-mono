/** FIFO serial executor for new-actor handshake segments (B6). */
export class SerialQueue {
	private tail: Promise<void> = Promise.resolve();

	enqueue<T>(segment: () => Promise<T>): Promise<T> {
		const run = this.tail.then(segment);
		this.tail = run.then(() => undefined, () => undefined);
		return run;
	}
}
