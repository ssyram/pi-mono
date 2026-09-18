import assert from "node:assert/strict";
import { it } from "node:test";
import { prepareCompactionRequest } from "../hooks/prepare-compaction-request.js";
import { user } from "./compaction-reference-fixtures.js";
import {
	compactEvent,
	context,
	noTasks,
} from "./prepare-compaction-request-fixtures.js";
import {
	completeSimple,
	providerCallCount,
} from "./prepare-compaction-request-provider-guard.js";

it("loads native functions without reaching the fail-fast provider boundary", () => {
	assert.equal(providerCallCount, 0);
	const request = prepareCompactionRequest(
		compactEvent([user("source")]),
		context,
		noTasks,
	);
	assert.equal(request.finalizeSummary("@!1@"), "source");
	assert.equal(providerCallCount, 0);
	assert.throws(() => completeSimple(), /Provider calls are forbidden/);
	assert.equal(providerCallCount, 1);
});
