import { closeSync, fstatSync, openSync, readSync } from "node:fs";

export const OUTPUT_TAIL_BYTES = 8192;

/** Reads at most maxBytes from the end of a file; undefined when unreadable, "" when empty. */
export function readTail(path: string, maxBytes: number): string | undefined {
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return undefined;
	}
	try {
		const size = fstatSync(fd).size;
		if (size === 0) return "";
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		readSync(fd, buffer, 0, length, size - length);
		return buffer.toString("utf8");
	} finally {
		closeSync(fd);
	}
}
