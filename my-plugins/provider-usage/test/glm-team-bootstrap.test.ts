import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import bootstrap from "../src/bootstrap.js";
import type { UsageFooter } from "../src/footer-component.js";
import type { PiEventHandler, PiExtensionContext } from "../src/pi-extension-contract.js";
import { makeModel } from "./test-model.js";

test("bootstrap uses only global teams for footer and commands and rereads edited settings", async () => {
	const root = await mkdtemp(join(tmpdir(), "usage-global-team-"));
	const project = join(root, "project");
	const agent = join(root, "agent");
	await mkdir(join(project, ".pi"), { recursive: true });
	await mkdir(agent);
	const team = { providers: ["first", "second"], organization: "org", project: "project" };
	const save = (project: string) =>
		writeFile(
			join(agent, "settings.json"),
			JSON.stringify({
				"provider-usage.glmTeams": [{ ...team, project }],
			}),
		);
	await save(team.project);
	await writeFile(
		join(project, ".pi/settings.json"),
		JSON.stringify({
			"provider-usage.glmTeams": [{ ...team, organization: "must-not-use-local-organization" }],
		}),
	);
	const previousAgent = process.env.PI_CODING_AGENT_DIR;
	const originalFetch = globalThis.fetch;
	process.env.PI_CODING_AGENT_DIR = agent;
	const requests: string[] = [];
	const projects: string[] = [];
	globalThis.fetch = async (input, options) => {
		assert.equal(String(input), "https://open.bigmodel.cn/api/monitor/usage/quota/limit?type=2");
		const headers = new Headers(options?.headers);
		const key = headers.get("Authorization") ?? "";
		requests.push(key);
		projects.push(headers.get("bigmodel-project") ?? "");
		assert.equal(headers.get("bigmodel-organization"), team.organization);
		return Response.json({
			success: true,
			code: 200,
			data: { limits: [{ type: "CREDIT_LIMIT", percentage: key === "key-first" ? 23 : 71, unit: 6, number: 1 }] },
		});
	};
	const handlers = new Map<string, PiEventHandler[]>();
	const commands = new Map<string, { handler(args: string, context: PiExtensionContext): Promise<void> }>();
	const listeners = new Map<string, Set<(data: unknown) => void>>();
	const pi = {
		on(event: string, handler: PiEventHandler) {
			const registered = handlers.get(event) ?? [];
			registered.push(handler);
			handlers.set(event, registered);
			return () => {};
		},
		events: {
			emit(channel: string, data: unknown) {
				for (const listener of listeners.get(channel) ?? []) listener(data);
			},
			on(channel: string, listener: (data: unknown) => void) {
				const registered = listeners.get(channel) ?? new Set();
				registered.add(listener);
				listeners.set(channel, registered);
				return () => {
					registered.delete(listener);
				};
			},
		},
		registerCommand(name: string, options: { handler(args: string, context: PiExtensionContext): Promise<void> }) {
			commands.set(name, options);
		},
		appendEntry() {
			throw new Error("credentials must not be saved in session entries");
		},
	};
	const first = makeModel({ provider: "first", baseUrl: "https://proxy.example/v1" });
	const second = makeModel({ provider: "second", baseUrl: "https://api.z.ai/api/coding/paas/v4" });
	const notices: string[] = [];
	let footer: UsageFooter | undefined;
	const context: PiExtensionContext & { cwd: string } = {
		cwd: project,
		mode: "tui",
		model: first,
		sessionManager: {
			getSessionId: () => "session-1",
			getCwd: () => project,
			getEntries: () => [],
			getSessionName: () => undefined,
		},
		modelRegistry: {
			getAll: () => [first, second],
			getAvailable: () => [first, second],
			getProvider: () => undefined,
			getApiKeyAndHeaders: async (model) => ({ ok: true, apiKey: `key-${model.provider}` }),
			isUsingOAuth: () => false,
		},
		ui: {
			setFooter(factory) {
				if (factory)
					footer = factory(
						{ requestRender() {} },
						{ fg: (_color, text) => text, bold: (text) => text },
						{
							getGitBranch: () => null,
							getExtensionStatuses: () => new Map(),
							getAvailableProviderCount: () => 2,
							onBranchChange: () => () => {},
						},
					);
			},
			notify: (message) => {
				notices.push(message);
			},
			addAutocompleteProvider() {},
		},
		getContextUsage: () => undefined,
	};
	try {
		await bootstrap(pi as unknown as Parameters<typeof bootstrap>[0]);
		for (const handler of handlers.get("session_start") ?? []) await handler({}, context);
		for (let tick = 0; tick < 100; tick += 1) {
			if (footer?.render(160).join("\n").includes("23%(week)")) break;
			await setImmediate();
		}
		assert.match(footer?.render(160).join("\n") ?? "", /23%\(week\)/);
		assert.deepEqual(requests, ["key-first"]);
		const command = commands.get("provider-usage");
		assert.ok(command);
		await save("updated-global-project");
		await command.handler("first second", context);
		assert.deepEqual(requests, ["key-first", "key-first", "key-second"]);
		assert.deepEqual(projects, ["project", "updated-global-project", "updated-global-project"]);
		assert.match(notices.at(-1) ?? "", /^first: 额度 已用 23%\(week\)\nsecond: 额度 已用 71%\(week\)$/);
		context.model = second;
		for (const handler of handlers.get("model_select") ?? []) await handler({ model: second }, context);
		for (let tick = 0; tick < 100; tick += 1) {
			if (footer?.render(160).join("\n").includes("71%(week)")) break;
			await setImmediate();
		}
		assert.match(footer?.render(160).join("\n") ?? "", /71%\(week\)/);
		assert.doesNotMatch(footer?.render(160).join("\n") ?? "", /23%\(week\)/);
		assert.equal(requests.at(-1), "key-second");
		await writeFile(
			join(agent, "settings.json"),
			JSON.stringify({
				"provider-usage.glmTeams": [team, team],
			}),
		);
		await command.handler("first", context);
		assert.match(notices.at(-1) ?? "", /first: CONFIG/);
		assert.equal(requests.length, 4);
	} finally {
		for (const handler of handlers.get("session_shutdown") ?? []) await handler({}, context);
		globalThis.fetch = originalFetch;
		if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgent;
		await rm(root, { recursive: true, force: true });
	}
});
