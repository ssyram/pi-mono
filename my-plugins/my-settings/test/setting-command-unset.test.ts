import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { MY_SETTING_HELP, parseSettingCommand } from "../setting-command-parse.ts";
import { commandFixture, readJson } from "./setting-command-fixture.ts";

test("unset command removes file keys and appends a session tombstone", async (t) => {
	const h = await commandFixture(t);
	await h.run("set --global --local --session e2e.flag true");
	await h.run("unset --global --local --session e2e.flag");
	assert.deepEqual(await readJson(join(h.globalRoot, "settings.json")), {});
	assert.deepEqual(await readJson(join(h.cwd, ".pi/settings.json")), {});
	assert.deepEqual(h.entries.at(-1)?.data, { removed: ["e2e.flag"] });
	const text = h.outputs.at(-1) ?? "";
	assert.match(text, /unset-global-only ok/);
	assert.match(text, /unset-local-only ok/);
	assert.match(text, /unset-session-only ok/);
});

test("unset --session cancels the overlay and lower layers show through", async (t) => {
	const h = await commandFixture(t);
	await h.run('set --global merge.key "global-value"');
	await h.run('set --session merge.key "session-value"');
	await h.run("get merge.key");
	assert.match(h.outputs.at(-1) ?? "", /merged {2}"session-value"/);
	await h.run("unset --session merge.key");
	await h.run("get merge.key");
	const text = h.outputs.at(-1) ?? "";
	assert.match(text, /session \(unset\)/);
	assert.match(text, /merged {2}"global-value"/);
	assert.deepEqual(await readJson(join(h.globalRoot, "settings.json")), {
		"merge.key": "global-value",
	});
});

test("unset validates flags and keys", async (t) => {
	const h = await commandFixture(t);
	await h.run("unset e2e.flag");
	assert.match(h.outputs.at(-1) ?? "", /requires at least one of/);
	await h.run("unset --global");
	assert.match(h.outputs.at(-1) ?? "", /requires at least one KEY/);
	const parsed = parseSettingCommand("unset --global --session --local-file p.json a b");
	assert.equal(parsed.kind, "unset");
	if (parsed.kind === "unset") {
		assert.deepEqual(parsed.scopes, ["global", "session"]);
		assert.deepEqual(parsed.keys, ["a", "b"]);
		assert.equal(parsed.paths.localFile, "p.json");
	}
	assert.ok(MY_SETTING_HELP.includes("unset"));
});
