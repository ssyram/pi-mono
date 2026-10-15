import assert from "node:assert/strict";
import { test } from "node:test";
import { copySettings } from "../json-settings.ts";
import { parseSettingsOperation } from "../settings-operation.ts";

test("JSON snapshots reject getters and serialization hooks without executing them", () => {
	let calls = 0;
	const getter = Object.defineProperty({}, "value", {
		enumerable: true,
		get() {
			calls++;
			return Promise.reject(new Error("getter must not execute"));
		},
	});
	const serializer = Object.defineProperty({}, "toJSON", {
		value() {
			calls++;
			return Promise.reject(new Error("serializer must not execute"));
		},
	});
	for (const value of [getter, serializer]) {
		const result = copySettings(value);
		assert.equal(result.ok, false);
		if (result.ok) assert.fail("Expected invalid data result");
		assert.equal(result.error.code, "INVALID_REQUEST");
	}
	const operation = Object.defineProperty({ op: "query" }, "query", {
		get() {
			calls++;
			return Promise.reject(new Error("operation getter must not execute"));
		},
	});
	assert.equal(parseSettingsOperation(operation).ok, false);
	assert.equal(calls, 0);
});

test("snapshots retain JSON data keys and nested arrays without sharing input references", () => {
	const input = JSON.parse(
		'{"__proto__":{"polluted":true},"toJSON":"data","list":[null,false,0,{"text":"value"}]}',
	) as { list: [null, false, 0, { text: string }] };
	const copied = copySettings(input);
	assert.ok(copied.ok);
	assert.deepEqual(copied.value, input);
	assert.notEqual(copied.value, input);
	input.list[3].text = "changed";
	assert.deepEqual(copied.value.list, [null, false, 0, { text: "value" }]);
	assert.equal(Object.getPrototypeOf(copied.value), Object.prototype);
	assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
});

test("sparse arrays are rejected before traversing their declared length", () => {
	const result = copySettings({ list: new Array(1_000_000) });
	assert.equal(result.ok, false);
	if (result.ok) assert.fail("Expected invalid array result");
	assert.equal(result.error.code, "INVALID_REQUEST");
});

test("optional operation metadata can be explicitly undefined while settings values cannot", () => {
	assert.ok(
		parseSettingsOperation({
			op: "query",
			query: {
				defaults: {},
				globalPath: undefined,
				localPath: null,
				scope: undefined,
			},
		}).ok,
	);
	assert.equal(
		parseSettingsOperation({
			op: "save-session",
			save: { values: { bad: undefined } },
		}).ok,
		false,
	);
});
