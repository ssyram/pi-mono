import type { Settings, SettingsOutcome, SettingValue } from "./protocol.ts";
import { settingsFailure } from "./settings-error.ts";

export function copySettings(value: unknown): SettingsOutcome<Settings> {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return settingsFailure("INVALID_REQUEST", "Settings must be a JSON object");
		}
		const holder: Settings = Object.create(null);
		const ancestors = new Set<object>();
		const pending: {
			value: unknown;
			parent: Settings | SettingValue[];
			key: string;
			leave?: boolean;
		}[] = [{ value, parent: holder, key: "root" }];
		while (pending.length) {
			const frame = pending.pop();
			if (!frame) break;
			const item = frame.value;
			if (frame.leave && typeof item === "object" && item !== null) {
				ancestors.delete(item);
				continue;
			}
			let copied: SettingValue;
			if (
				item === null ||
				typeof item === "string" ||
				typeof item === "boolean" ||
				(typeof item === "number" && Number.isFinite(item))
			) {
				copied = item;
			} else {
				if (typeof item !== "object" || item === null) {
					return settingsFailure("INVALID_REQUEST", "Settings must contain JSON values only");
				}
				if (ancestors.has(item)) return settingsFailure("INVALID_REQUEST", "Settings must not contain cycles");
				const list = Array.isArray(item);
				const prototype = Object.getPrototypeOf(item);
				if (!list && prototype !== Object.prototype && prototype !== null) {
					return settingsFailure("INVALID_REQUEST", "Settings objects must be plain JSON objects");
				}
				const fields = Object.getOwnPropertyDescriptors(item);
				for (const descriptor of Object.values(fields)) {
					if (descriptor.get || descriptor.set)
						return settingsFailure("INVALID_REQUEST", "Settings must contain data properties only");
				}
				if (typeof fields.toJSON?.value === "function")
					return settingsFailure("INVALID_REQUEST", "Settings must not contain serialization hooks");
				const container: Settings | SettingValue[] = list ? [] : Object.create(null);
				copied = container;
				ancestors.add(item);
				pending.push({ ...frame, leave: true });
				if (list) {
					const length: unknown = fields.length?.value;
					if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 0xffffffff) {
						return settingsFailure("INVALID_REQUEST", "Settings arrays must have a valid length");
					}
					for (let index = 0; index < length; index++) {
						const descriptor = fields[index];
						if (!descriptor) return settingsFailure("INVALID_REQUEST", "Settings arrays must not contain holes");
						pending.push({
							value: descriptor.value,
							parent: container,
							key: String(index),
						});
					}
				} else {
					for (const [key, descriptor] of Object.entries(fields)) {
						if (descriptor.enumerable) pending.push({ value: descriptor.value, parent: container, key });
					}
				}
			}
			if (Array.isArray(frame.parent)) frame.parent[Number(frame.key)] = copied;
			else frame.parent[frame.key] = copied;
		}
		return {
			ok: true,
			value: JSON.parse(JSON.stringify(holder.root)) as Settings,
		};
	} catch (error) {
		return settingsFailure("INVALID_REQUEST", error);
	}
}
