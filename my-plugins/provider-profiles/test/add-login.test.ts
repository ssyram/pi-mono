import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { registerAddLoginCommand } from "../commands.js";
import { wrapApiKeyAuth } from "../instantiator.js";

interface Notification {
	text: string;
	level: string;
}

interface FakeUI {
	notifications: Notification[];
	notify(text: string, level?: string): void;
}

interface FakePi {
	commands: Map<string, { handler: (args: string, ctx: { ui: FakeUI }) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null }>;
	registered: string[];
	registerProvider(provider: { id: string }): void;
}

function createFakePi(): FakePi {
	const pi = {
		commands: new Map(),
		registered: [],
		registerProvider(provider: { id: string }) {
			pi.registered.push(provider.id);
		},
		registerCommand(
			name: string,
			options: { handler: (args: string, ctx: { ui: FakeUI }) => Promise<void>; getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }> | null },
		) {
			pi.commands.set(name, options);
		},
	} as FakePi;
	return pi;
}

function createFakeCtx(): { ui: FakeUI } {
	const notifications: Notification[] = [];
	return { ui: { notifications, notify(text, level = "info") { notifications.push({ text, level }); } } };
}

let tempDir: string;
let configPath: string;
let modelsJsonPath: string;

beforeEach(async () => {
	tempDir = await mkdtemp(join(tmpdir(), "pp-add-login-"));
	configPath = join(tempDir, "provider-profiles.json");
	modelsJsonPath = join(tempDir, "models.json");
});

afterEach(async () => {
	await rm(tempDir, { recursive: true, force: true });
	delete process.env.PP_TEST_KEY;
});

function register(pi: FakePi): void {
	registerAddLoginCommand(pi as unknown as Parameters<typeof registerAddLoginCommand>[0], configPath, modelsJsonPath);
}

async function run(pi: FakePi, args: string): Promise<Notification[]> {
	const command = pi.commands.get("add-login");
	if (!command) throw new Error("add-login not registered");
	const ctx = createFakeCtx();
	await command.handler(args, ctx);
	return ctx.ui.notifications;
}

describe("/add-login help surface", () => {
	test("bare, help, h, ?, -h, --help all print help", async () => {
		const pi = createFakePi();
		register(pi);
		for (const variant of ["", "help", "h", "?", "-h", "--help"]) {
			const notes = await run(pi, variant);
			expect(notes[0]?.level).toBe("info");
			expect(notes[0]?.text).toContain("/add-login <name> <provider> [apiKey]");
			expect(notes[0]?.text).toContain("How to remove");
		}
	});
});

describe("/add-login happy path", () => {
	test("adds entry, registers immediately, preserves existing entries", async () => {
		await writeFile(configPath, JSON.stringify({ existing: { provider: "zai" } }, null, "\t"));
		const pi = createFakePi();
		register(pi);
		const notes = await run(pi, "codex-010 openai-codex");
		expect(notes[0]?.text).toBe("[add-login] added and registered codex-010 (openai-codex)");
		expect(pi.registered).toEqual(["codex-010"]);
		const saved = JSON.parse(await readFile(configPath, "utf-8"));
		expect(Object.keys(saved).sort()).toEqual(["codex-010", "existing"]);
	});

	test("zai entry with $ENV_VAR apiKey is stored raw", async () => {
		const pi = createFakePi();
		register(pi);
		await run(pi, "zai-900 zai $PP_TEST_KEY");
		const saved = JSON.parse(await readFile(configPath, "utf-8"));
		expect(saved["zai-900"]).toEqual({ provider: "zai", apiKey: "$PP_TEST_KEY" });
	});
});

describe("/add-login rejections", () => {
	test("duplicate name is rejected without touching the file", async () => {
		await writeFile(configPath, JSON.stringify({ dup: { provider: "zai" } }, null, "\t"));
		const before = await readFile(configPath, "utf-8");
		const pi = createFakePi();
		register(pi);
		const notes = await run(pi, "dup zai");
		expect(notes[0]?.level).toBe("warning");
		expect(notes[0]?.text).toContain("already exists");
		expect(await readFile(configPath, "utf-8")).toBe(before);
		expect(pi.registered).toEqual([]);
	});

	test("models.json collision is rejected", async () => {
		await writeFile(modelsJsonPath, JSON.stringify({ providers: { claimed: {} } }));
		const pi = createFakePi();
		register(pi);
		const notes = await run(pi, "claimed zai");
		expect(notes[0]?.text).toContain("models.json");
	});

	test("reserved key and unknown provider are rejected", async () => {
		const pi = createFakePi();
		register(pi);
		expect((await run(pi, "constructor zai"))[0]?.text).toContain("reserved");
		expect((await run(pi, "x not-a-provider"))[0]?.text).toContain("unrecognized provider");
	});

	test("spaced apiKey lands in the argument-count guidance, not the file", async () => {
		const pi = createFakePi();
		register(pi);
		const notes = await run(pi, "zai-901 zai secret with spaces");
		expect(notes[0]?.text).toContain("single token");
		expect(pi.registered).toEqual([]);
	});
});

describe("/add-login completions (position-state model)", () => {
	test("state A: only spaces after the command completes the single help item", () => {
		const pi = createFakePi();
		register(pi);
		const complete = pi.commands.get("add-login")?.getArgumentCompletions;
		if (!complete) throw new Error("missing completions");
		expect(complete("")).toEqual([{ value: "help", label: "help", description: "show /add-login help" }]);
		expect(complete(" ")).toEqual([{ value: "help", label: "help", description: "show /add-login help" }]);
	});

	test("state B: help-like first token completes help; flag-like yields nothing", () => {
		const pi = createFakePi();
		register(pi);
		const complete = pi.commands.get("add-login")?.getArgumentCompletions;
		if (!complete) throw new Error("missing completions");
		expect(complete("h")?.map((item) => item.value)).toEqual(["help"]);
		expect(complete("he")?.map((item) => item.value)).toEqual(["help"]);
		expect(complete("-h")).toBeNull();
		expect(complete("?")).toBeNull();
	});

	test("state B'/C: a NAME (typed or space-terminated) completes the dynamic built-in list with the name kept", () => {
		const pi = createFakePi();
		register(pi);
		const complete = pi.commands.get("add-login")?.getArgumentCompletions;
		if (!complete) throw new Error("missing completions");
		const all = complete("acct1")?.map((item) => item.value) ?? [];
		expect(all.length).toBeGreaterThan(3);
		for (const known of ["acct1 openai-codex", "acct1 zai", "acct1 zai-coding-cn"]) {
			expect(all).toContain(known);
		}
		expect(all.every((value) => value.startsWith("acct1 "))).toBe(true);
		expect(complete("acct1 ")?.map((item) => item.value)).toEqual(all);
		const za = complete("acct1 za")?.map((item) => item.value) ?? [];
		expect(za).toContain("acct1 zai");
		expect(za).toContain("acct1 zai-coding-cn");

		const codex = complete("acct1 codex")?.map((item) => item.value) ?? [];
		expect(codex).toContain("acct1 openai-codex");
	});

	test("state D: apiKey slot has no completion", () => {
		const pi = createFakePi();
		register(pi);
		const complete = pi.commands.get("add-login")?.getArgumentCompletions;
		if (!complete) throw new Error("missing completions");
		expect(complete("acct1 zai ")).toBeNull();
	});
});

describe("apiKey env template resolution (P.local.2.1)", () => {
	const auth = {
		name: "Z.AI API key",
		login: undefined,
		resolve: undefined,
	};

	test("literal key passes through; $VAR expands; unset $VAR is unconfigured", async () => {
		const wrapped = wrapApiKeyAuth(auth as never, "$PP_TEST_KEY");
		process.env.PP_TEST_KEY = "secret-value";
		const resolved = await wrapped.resolve({
			ctx: {} as never,
			credential: undefined,
			signal: new AbortController().signal,
		});
		expect(resolved).toMatchObject({ auth: { apiKey: "secret-value" }, source: "profile config" });

		delete process.env.PP_TEST_KEY;
		const unresolved = await wrapped.resolve({
			ctx: {} as never,
			credential: undefined,
			signal: new AbortController().signal,
		});
		expect(unresolved).toBeUndefined();
	});

	test("${VAR} and $$ escape forms behave", async () => {
		process.env.PP_TEST_KEY = "v";
		const brace = wrapApiKeyAuth(auth as never, "pre-${PP_TEST_KEY}-post");
		expect(
			await brace.resolve({ ctx: {} as never, credential: undefined, signal: new AbortController().signal }),
		).toMatchObject({ auth: { apiKey: "pre-v-post" } });

		const literal = wrapApiKeyAuth(auth as never, "a$$b");
		expect(
			await literal.resolve({ ctx: {} as never, credential: undefined, signal: new AbortController().signal }),
		).toMatchObject({ auth: { apiKey: "a$b" } });
	});
});
