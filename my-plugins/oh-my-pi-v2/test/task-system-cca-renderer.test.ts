import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { renderTaskCall, renderTaskResult } from "../tools/task-renderers.js";

const plain = {
	fg: (_color: string, value: string) => value,
	bold: (value: string) => value,
} as Theme;
const options = { expanded: false, isPartial: false };
const content = [{ type: "text" as const, text: "#1 done" }];

for (const details of [
	{ action: "list", tasks: [null] },
	{ action: "list", tasks: [{ id: 1, text: "bad", status: "pending" }] },
	{
		action: "done",
		tasks: [{ id: 1, text: "bad", status: "expired", expireReason: 7 }],
	},
]) {
	test(`renderer contains malformed details for ${details.action}`, () => {
		const result = { content, details };
		const component = renderTaskResult(result, options, plain);
		assert.match(component.render(200).join("\n"), /rendering unavailable/);
		assert.equal(result.content, content);
	});
}

test("task renderer boundaries contain theme failures with a dependency-free diagnostic", () => {
	const broken = {
		fg() {
			throw new Error("theme failed");
		},
		bold() {
			throw new Error("theme failed");
		},
	} as unknown as Theme;
	assert.match(
		renderTaskCall({ action: "list" }, broken).render(200).join("\n"),
		/rendering unavailable/,
	);
	assert.match(
		renderTaskResult(
			{ content, details: { action: "list", tasks: [] } },
			options,
			broken,
		)
			.render(200)
			.join("\n"),
		/rendering unavailable/,
	);
});
