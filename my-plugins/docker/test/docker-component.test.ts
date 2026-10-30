import assert from "node:assert/strict";
import { test } from "node:test";
import { DockerComponent, DOCKER_MIN_CONTENT_LINES } from "../component.js";
import type { DockerSection } from "../component.js";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;

function makeTui(rows: number) {
	let renders = 0;
	const tui = {
		requestRender: () => {
			renders += 1;
		},
		terminal: { rows, columns: 100 },
	} as unknown as Pick<TUI, "requestRender" | "terminal">;
	return { tui, renders: () => renders };
}

function section(id: string, order: number, lineCount: number): DockerSection {
	return {
		id,
		title: `section ${id}`,
		order,
		lines: Array.from({ length: lineCount }, (_, index) => `${id}-${index}`),
	};
}

test("renders sections ordered by order field inside a box", () => {
	const { tui } = makeTui(40);
	const component = new DockerComponent(theme, tui);
	component.updateSection(section("a", 2, 2));
	component.updateSection(section("b", 1, 2));
	const lines = component.render(30);
	const joined = lines.join("\n");
	assert.ok(joined.includes("▸ section b"));
	assert.ok(joined.includes("▸ section a"));
	assert.ok(joined.indexOf("section b") < joined.indexOf("section a"));
	assert.ok(lines[0]?.startsWith("╭"));
	assert.ok(lines.at(-1)?.startsWith("╰"));
});

test("scrolling clamps at both ends and reflects the visible range", () => {
	const { tui } = makeTui(40);
	const component = new DockerComponent(theme, tui);
	component.updateSection(section("long", 1, 200));
	component.render(30);
	const bodyRows = Math.floor(40 * 0.7) - 3;
	const maxScroll = 1 + 200 - Math.max(1, bodyRows);
	component.scrollUp(5);
	const top = component.render(30).at(-1) ?? "";
	assert.match(top, /\[1 - \d+ \/ 201\]/);
	component.scrollDown(10_000);
	const bottom = component.render(30).at(-1) ?? "";
	assert.match(bottom, new RegExp(`\\[${maxScroll + 1} - 201 / 201\\]`));
	component.scrollDown(5);
	const still = component.render(30).at(-1) ?? "";
	assert.equal(still, bottom);
});

test("removeSection re-clamps scroll and clear resets it", () => {
	const { tui } = makeTui(40);
	const component = new DockerComponent(theme, tui);
	component.updateSection(section("long", 1, 200));
	component.render(30);
	component.scrollDown(10_000);
	component.removeSection("long");
	assert.equal(component.render(30).length > 0, true);
	component.updateSection(section("s", 1, 2));
	const bottom = component.render(30).at(-1) ?? "";
	assert.match(bottom, /\[1 - \d+ \/ 3\]/);
	component.clear();
	assert.match(component.render(30).join("\n"), /empty/);
});

test("too-short terminals show the height warning instead of content", () => {
	const { tui } = makeTui(10);
	const component = new DockerComponent(theme, tui);
	component.updateSection(section("a", 1, 5));
	const lines = component.render(30);
	const joined = lines.join("\n");
	assert.ok(joined.includes("Docker height too small"));
	assert.ok(joined.includes(String(DOCKER_MIN_CONTENT_LINES)));
	component.scrollDown(5);
	assert.doesNotMatch(component.render(30).join("\n"), /a-0/);
});
