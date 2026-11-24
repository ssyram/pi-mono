/**
 * Failure warning sink for the official-catalog sync (robustness §2). One
 * visible warning per source+failure-kind episode; the episode clears on
 * recovery so a recurring fault can warn again. Before attach, warnings are
 * buffered; on attach they flush through the UI channel when a dialog UI
 * exists, or through safe stderr otherwise (print/json modes) — never the
 * model stdout protocol. Warning output itself can never throw and never
 * carries credentials: messages are fixed non-secret strings.
 */

export type WarningLevel = "info" | "warning" | "error";
export type NotifyChannel = (message: string, level: WarningLevel) => void;

export interface WarningSink {
	warn(key: string, message: string): void;
	/** Clears every active episode whose key starts with the prefix. */
	resolve(prefix: string): void;
	attach(notify: NotifyChannel): void;
}

function stderrChannel(): NotifyChannel {
	return (message, level) => {
		try {
			process.stderr.write(`[provider-profiles] ${level}: ${message}\n`);
		} catch {
			// A physically unusable stderr is an explicit environment premise;
			// warning output must never break the original provider behavior.
		}
	};
}

export function createWarningSink(): WarningSink {
	const active = new Set<string>();
	const buffered: { message: string; level: WarningLevel }[] = [];
	let channel: NotifyChannel | undefined;
	return {
		warn(key, message) {
			if (active.has(key)) return;
			active.add(key);
			if (channel === undefined) {
				buffered.push({ message, level: "warning" });
				return;
			}
			try {
				channel(message, "warning");
			} catch {
				stderrChannel()(message, "warning");
			}
		},
		resolve(prefix) {
			for (const key of active) {
				if (key.startsWith(prefix)) active.delete(key);
			}
		},
		attach(notify) {
			channel = notify;
			for (const entry of buffered) {
				try {
					notify(entry.message, entry.level);
				} catch {
					stderrChannel()(entry.message, entry.level);
				}
			}
			buffered.length = 0;
		},
	};
}
