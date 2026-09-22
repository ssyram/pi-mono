import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	extractCompactionFileOperations,
	formatCompactionFileOperations,
} from "../hooks/compaction-file-operations.js";
import { prepareCompactionRequest } from "../hooks/prepare-compaction-request.js";
import { assistant, user } from "./compaction-reference-fixtures.js";
import { compactEvent, context, noTasks } from "./prepare-compaction-request-fixtures.js";
import { providerCallCount } from "./prepare-compaction-request-provider-guard.js";

afterEach(() => assert.equal(providerCallCount, 0));

function fileCall(path: string, name: "read" | "write" | "edit" = "edit") {
	return assistant([{ type: "toolCall", id: "call", name, arguments: { path } }]);
}

describe("prepare compaction request finalization", () => {
	it("appends the native suffix exactly once, after expansion, including OFF", () => {
		const event = compactEvent([user("raw @!88@\r\n "), fileCall("path@!999@")]);
		const suffix = formatCompactionFileOperations(
			extractCompactionFileOperations(event.preparation.messagesToSummarize),
		);
		const on = prepareCompactionRequest(event, context, noTasks);
		const off = prepareCompactionRequest(compactEvent([fileCall("path@!999@")]), context, noTasks);
		assert.equal(on.finalizeSummary("@!1@"), `raw @!88@\r\n ${suffix}`);
		assert.equal(on.finalizeSummary("@!1@"), `raw @!88@\r\n ${suffix}`);
		assert.equal(off.finalizeSummary("@!1@"), `@!1@${suffix}`);
		assert.equal(on.finalizeSummary("@!999999@"), `(unresolved compaction reference)${suffix}`);
	});

	it("persists compact current file lists in ON and OFF finalization", () => {
		const calls = [
			fileCall("biome.json", "read"),
			fileCall("package.json", "read"),
			fileCall("workspace/hooks/a.ts", "read"),
			fileCall("workspace/hooks/b.ts", "read"),
			fileCall("workspace/test/c.ts", "read"),
			fileCall("workspace/deep/alpha.ts", "read"),
			fileCall("workspace/deep/alpha.ts"),
			fileCall("workspace/deep/beta.ts"),
		];
		const suffix =
			"\n\n<read-files>\nbiome.json\npackage.json\nworkspace/{hooks/{a.ts,b.ts},test/c.ts}\n</read-files>" +
			"\n\n<modified-files>\nworkspace/deep/{alpha.ts,beta.ts}\n</modified-files>";
		const on = prepareCompactionRequest(compactEvent([user("source"), ...calls]), context, noTasks);
		const off = prepareCompactionRequest(compactEvent(calls), context, noTasks);
		assert.equal(on.finalizeSummary("@!1@"), `source${suffix}`);
		assert.equal(off.finalizeSummary("draft"), `draft${suffix}`);
	});

	it("passes the old suffix through unchanged and appends only the new suffix", () => {
		const oldSuffix = "\n\n<modified-files>\nworkspace/deep/alpha.ts\nworkspace/deep/beta.ts\n</modified-files>";
		const request = prepareCompactionRequest(
			compactEvent([user("request"), fileCall("new-file")], `summary${oldSuffix}`),
			context,
			noTasks,
		);
		assert.match(
			request.prompt,
			/@!1@summary@!@\n\n<modified-files>\nworkspace\/deep\/alpha\.ts\nworkspace\/deep\/beta\.ts\n<\/modified-files>/,
		);
		assert.doesNotMatch(request.prompt, /workspace\/deep\/\{alpha\.ts,beta\.ts\}/);
		assert.equal(request.finalizeSummary("@!1@"), "summary\n\n<modified-files>\nnew-file\n</modified-files>");
	});

	it("rejects blank drafts and empty expanded bodies before adding any suffix", () => {
		const event = compactEvent([user("source"), fileCall("file")]);
		const request = prepareCompactionRequest(event, context, noTasks);
		for (const draft of ["", " \r\n", "@!@", "@!1[0:0]@", "\n@!1[3:1]@ \n"]) {
			assert.equal(request.finalizeSummary(draft), "", JSON.stringify(draft));
		}
		const whitespace = prepareCompactionRequest(compactEvent([user(" \r\n"), fileCall("file")]), context, noTasks);
		assert.equal(whitespace.finalizeSummary("@!1@"), "");
		const off = prepareCompactionRequest(compactEvent([fileCall("file")]), context, noTasks);
		assert.equal(off.finalizeSummary(" \r\n"), "");
	});

	it("preserves long free prose and whitespace beyond maxTokens, including the suffix", () => {
		const event = compactEvent([user("source"), fileCall("path@!999@")]);
		event.preparation.settings.reserveTokens = 10;
		const request = prepareCompactionRequest(event, context, noTasks);
		const suffix = formatCompactionFileOperations(
			extractCompactionFileOperations(event.preparation.messagesToSummarize),
		);
		const body = ` \r\n${"long free prose ".repeat(10000)}\r\n `;
		assert.equal(request.maxTokens, Math.floor(0.8 * 10));
		assert.equal(request.finalizeSummary(body), body + suffix);
	});

	it("preserves short references expanding far beyond maxTokens without rescanning", () => {
		const source = ` \r\n${"long source @!999999@ @|!1@ ".repeat(10000)}\r\n `;
		const event = compactEvent([user(source), fileCall("path@!999@")]);
		event.preparation.settings.reserveTokens = 10;
		const request = prepareCompactionRequest(event, context, noTasks);
		const suffix = formatCompactionFileOperations(
			extractCompactionFileOperations(event.preparation.messagesToSummarize),
		);
		assert.equal(request.maxTokens, Math.floor(0.8 * 10));
		assert.equal(request.finalizeSummary("@!1@"), source + suffix);
		assert.equal(request.finalizeSummary("@!1[0:400]@"), source.slice(0, 400) + suffix);
	});

	it("keeps interleaved request and file snapshots independent", () => {
		const message = user("first");
		const call = fileCall("first-file");
		const firstEvent = compactEvent([message, call]);
		const first = prepareCompactionRequest(firstEvent, context, noTasks);
		message.content = "changed";
		firstEvent.preparation.messagesToSummarize.push(fileCall("later-file"));
		const second = prepareCompactionRequest(
			compactEvent([user("second"), fileCall("second-file")]),
			context,
			noTasks,
		);
		assert.equal(second.finalizeSummary("@!1@"), "second\n\n<modified-files>\nsecond-file\n</modified-files>");
		assert.equal(first.finalizeSummary("@!1@"), "first\n\n<modified-files>\nfirst-file\n</modified-files>");
		assert.ok(Object.isFrozen(first));
		assert.deepEqual(Object.keys(first).sort(), ["finalizeSummary", "maxTokens", "prompt"]);
	});

	it("prepares and finalizes two rounds without historical IDs or providers", () => {
		const first = prepareCompactionRequest(
			compactEvent([user("keep exact @!literal@"), fileCall("old-file")]),
			context,
			noTasks,
		);
		const saved = first.finalizeSummary("Principle: small interfaces.\n@!1@");
		const second = prepareCompactionRequest(
			compactEvent([user("new request"), fileCall("new-file")], saved),
			context,
			noTasks,
		);
		assert.match(second.prompt, /@!1@Principle: small interfaces\.\nkeep exact @\|!literal@@!@\n\n<modified-files>/);
		assert.match(second.prompt, /\[User\]: @!2@new request@!@/);
		assert.equal(
			second.finalizeSummary("@!1@\n@!2@"),
			"Principle: small interfaces.\nkeep exact @!literal@\nnew request\n\n<modified-files>\nnew-file\n</modified-files>",
		);
	});
});
