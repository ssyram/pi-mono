import assert from "node:assert/strict";
import test from "node:test";
import { parseHostIdentity, parseLinuxHostIdentity, readHostIdentity } from "../src/runtime/host-identity.ts";

test("identity is an exact opaque scalar, not a wall-clock approximation", () => {
	assert.deepEqual(parseHostIdentity({ pid: 42, startId: "18446744073709551615" }, 42), { pid: 42, startId: "18446744073709551615" });
	for (const value of [{ pid: 43, startId: "1" }, { pid: 42, startId: "0" }, { pid: 42, startId: "1.1" },
		{ pid: 42, startId: "18446744073709551616" }, { pid: 42, startId: 1 }]) assert.throws(() => parseHostIdentity(value, 42));
});

test("Linux stat handles spaces/parentheses and selects the actual start field", () => {
	const fields = ["S", "1", ...Array.from({ length: 17 }, () => "0"), "123456", "0"];
	assert.deepEqual(parseLinuxHostIdentity(`42 (name with ) spaces) ${fields.join(" ")}`, 42), { pid: 42, startId: "123456" });
	assert.throws(() => parseLinuxHostIdentity(`43 (other) ${fields.join(" ")}`, 42));
});

test("actual supported host identity is stable and names the direct Pi/test parent", async () => {
	const first = await readHostIdentity(Date.now() + 10000);
	const second = await readHostIdentity(Date.now() + 10000);
	assert.equal(first.pid, process.pid);
	assert.deepEqual(second, first);
});
