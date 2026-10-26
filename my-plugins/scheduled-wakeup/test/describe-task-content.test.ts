import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeTaskContent } from "../src/v2/task-content.js";

describe("describeTaskContent", () => {
	it("summarizes only the first non-empty prompt line without merging", () => {
		assert.equal(
			describeTaskContent({ prompt: "first line\nsecond line" }),
			"first line",
		);
		assert.equal(describeTaskContent({ prompt: "\n  \nlead line\nmore" }), "lead line");
	});

	it("truncates a long first line at 80 characters with an ellipsis", () => {
		const exact = "a".repeat(80);
		const longer = `${exact}x`;
		assert.equal(describeTaskContent({ prompt: exact }), exact);
		assert.equal(describeTaskContent({ prompt: longer }), `${exact}...`);
	});

	it("summarizes the wake prompt of script tasks and names never tasks by script", () => {
		const scripts = [
			{ cwd: "/work", path: "/work/check.sh", params: [], timeoutSeconds: null },
			{ cwd: "/work", path: "/work/build.sh", params: [], timeoutSeconds: null },
		];
		assert.equal(
			describeTaskContent({
				scriptTask: { wakeUp: { kind: "always", prompt: "run it\nnow" }, scripts },
			}),
			"run it",
		);
		assert.equal(
			describeTaskContent({
				scriptTask: { wakeUp: { kind: "never" }, scripts: [scripts[0]!] },
			}),
			"运行 check.sh",
		);
		assert.equal(
			describeTaskContent({
				scriptTask: { wakeUp: { kind: "never" }, scripts },
			}),
			"运行 check.sh 等 2 个脚本",
		);
	});
});
