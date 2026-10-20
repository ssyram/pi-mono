import assert from "node:assert/strict";

export function captureWakeupPrompt(message: {
	customType: string;
	content: unknown;
}): string {
	assert.equal(message.customType, "loop-task-run");
	assert.equal(typeof message.content, "string");
	if (typeof message.content !== "string")
		assert.fail("expected string message");
	assert.match(message.content, /NOT sent by the user/);
	const match = /<prompts>\n([\s\S]*?)\n<\/prompts>/.exec(message.content);
	assert.ok(match);
	return match[1] ?? "";
}
