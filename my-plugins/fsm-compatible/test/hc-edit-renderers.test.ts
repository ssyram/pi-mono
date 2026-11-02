import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { hcEditRenderers, hcWriteRenderers } from "../src/tools/hc-edit-renderers.ts";

initTheme();

const THEME = new Proxy({}, { get: () => (...args: unknown[]) => String(args[args.length - 1] ?? "") }) as never;

function render(component: unknown): string {
	return String((component as { render(w: number): string[] }).render?.(200)?.map((line) => line.trimEnd()).join("\n") ?? component);
}

test("renderCall shows the path and up to three old/new lines", () => {
	const call = render(hcEditRenderers.renderCall?.({ filePath: "/w/a.ts", oldString: "a\n\nb\n\nc\nd", newString: "gamma" }, THEME, {} as never));
	assert.match(call, /edit \/w\/a\.ts/);
	assert.ok(call.includes("- a") && call.includes("- b") && call.includes("- c"), "three old preview lines");
	assert.ok(!call.includes("- d"), "fourth old line dropped");
	assert.ok(call.includes("+ gamma"));
	assert.equal(render(hcEditRenderers.renderCall?.({ filePath: "/w/a.ts" }, THEME, {} as never)), "edit /w/a.ts");
});

test("write renderCall shows path and first content lines; renderResult echoes success text", () => {
	const call = render(hcWriteRenderers.renderCall?.({ filePath: "/w/b.ts", content: "line1\nline2\nline3" }, THEME, {} as never));
	assert.match(call, /write \/w\/b\.ts/);
	assert.ok(call.includes("line1") && call.includes("line2") && !call.includes("line3"), "two preview lines");
	assert.equal(render(hcWriteRenderers.renderCall?.({ filePath: "/w/b.ts" }, THEME, {} as never)), "write /w/b.ts");
	assert.equal(render(hcWriteRenderers.renderResult?.({ content: [{ type: "text", text: "Wrote file successfully." }] } as never, {} as never, THEME, {} as never)), "Wrote file successfully.");
});

test("renderResult renders the HC wire patch with diff coloring", () => {
	const patch = "Index: /w/a.ts\n===================\n--- /w/a.ts\n+++ /w/a.ts\n@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n";
	const result = render(hcEditRenderers.renderResult?.({ details: { metadata: { filediff: { patch } } } } as never, {} as never, THEME, {} as never));
	assert.ok(result.includes("+new"), "added line survives");
	assert.ok(result.includes("-old"), "removed line survives");
	assert.ok(result.includes("@@ -1,2 +1,2 @@"), "hunk header passes through the same primitive the built-in renderer uses");
});

test("renderResult falls back to plain text for errors and foreign shapes", () => {
	assert.equal(render(hcEditRenderers.renderResult?.({ isError: true, content: [{ type: "text", text: "File not found: /w/a.ts" }] } as never, {} as never, THEME, {} as never)),
		"File not found: /w/a.ts");
	assert.equal(render(hcEditRenderers.renderResult?.({ content: [{ type: "text", text: "x" }] } as never, {} as never, THEME, {} as never)), "x");
});
