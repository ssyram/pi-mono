import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatCompactionPathList } from "../hooks/format-compaction-path-list.js";

function expand(pattern: string): string[] {
	const open = pattern.indexOf("{");
	if (open < 0) return [pattern];
	const alternatives: string[] = [];
	let depth = 0;
	let start = open + 1;
	for (let index = open + 1; index < pattern.length; index++) {
		const char = pattern[index];
		if (char === "{") depth++;
		if (char === "}" && depth > 0) {
			depth--;
			continue;
		}
		if (depth === 0 && (char === "," || char === "}")) {
			alternatives.push(pattern.slice(start, index));
			start = index + 1;
			if (char === "}") {
				return alternatives.flatMap((part) => expand(pattern.slice(0, open) + part + pattern.slice(index + 1)));
			}
		}
	}
	throw new Error("unbalanced output");
}

function assertRoundTrip(paths: readonly string[]): void {
	const result = formatCompactionPathList(paths);
	assert.ok(result.length <= paths.join("\n").length);
	assert.deepEqual(result.split("\n").flatMap(expand).sort(), [...paths].sort());
}

describe("formatCompactionPathList trie", () => {
	it("groups nested and non-adjacent prefixes, retaining standalone files", () => {
		const paths = ["A/B/C", "package.json", "A/E/F", "A/B/D", "biome.json", "other/root/file"];
		assert.equal(formatCompactionPathList(paths), "A/{B/{C,D},E/F}\npackage.json\nbiome.json\nother/root/file");
		assertRoundTrip(paths);
	});

	it("compresses read lists despite root-level config files", () => {
		const paths = ["biome.json", "my-plugins/omp/hooks/a.ts", "my-plugins/omp/test/b.ts", "package.json"];
		assert.equal(formatCompactionPathList(paths), "biome.json\nmy-plugins/omp/{hooks/a.ts,test/b.ts}\npackage.json");
	});

	it("keeps absolute and relative roots separate and supports special Map keys", () => {
		const paths = ["/workspace/a", "workspace/a", "/workspace/b", "workspace/b", "__proto__/x", "__proto__/y"];
		assert.equal(formatCompactionPathList(paths), "/workspace/{a,b}\nworkspace/{a,b}\n__proto__/{x,y}");
		assertRoundTrip([...paths, "constructor/prototype/a", "constructor/prototype/b"]);
	});

	it("preserves duplicates and paths that are also prefixes", () => {
		const paths = ["long-root/file", "long-root/file", "long-root/file/a", "long-root/file/b", "long-root"];
		assert.equal(formatCompactionPathList(paths), "long-root\nlong-root/{file,file,file/{a,b}}");
		assertRoundTrip(paths);
	});

	it("keeps empty, single and non-shorter lists byte-identical", () => {
		for (const paths of [[], ["package.json"], ["src/a.ts"], ["a/x", "a/y"], ["/a", "/b"]]) {
			assert.equal(formatCompactionPathList(paths), paths.join("\n"));
		}
	});

	it("preserves opaque paths locally without blocking safe branches", () => {
		for (const opaque of [
			"unsafe/é",
			"unsafe/a\r\nb",
			"unsafe/a b",
			"unsafe/a\tb",
			"",
			"\\\\server\\share",
			"C:/file.ts",
			"unsafe/./file.ts",
			"unsafe/../file.ts",
			"unsafe//file.ts",
			"unsafe/file.ts/",
			"unsafe/{file}.ts",
			"unsafe/a,b.ts",
			"unsafe/<file>.ts",
			"//server/share",
			"/",
			"unsafe/a\n",
			"unsafe/a\0",
		]) {
			const paths = [opaque, "long/parent/alpha.ts", "long/parent/beta.ts"];
			assert.equal(formatCompactionPathList(paths), `${opaque}\nlong/parent/{alpha.ts,beta.ts}`);
		}
	});

	it("leaves already grouped lines unchanged", () => {
		const paths = ["A/{B/{C,D},E/F}", "package.json"];
		assert.equal(formatCompactionPathList(paths), paths.join("\n"));
	});

	it("round-trips varied unordered multisets", () => {
		const pool = ["root", "root/a", "root/a/x", "root/a/y", "root/b/z", "other/a", "/root/a", "package.json"];
		for (let seed = 1; seed <= 128; seed++) {
			const paths = Array.from(
				{ length: 16 },
				(_, index) => pool[(seed * (index + 3) + index * index) % pool.length],
			);
			assertRoundTrip(Object.freeze(paths));
		}
	});

	it("renders deeply nested paths without recursive traversal", () => {
		const prefix = `${"deep/".repeat(12000)}parent`;
		assert.equal(formatCompactionPathList([`${prefix}/a`, `${prefix}/b`]), `${prefix}/{a,b}`);
	});

	it("does not mutate frozen input and falls back on a formatting exception", () => {
		const paths = Object.freeze(["long/parent/alpha.ts", "long/parent/beta.ts"]);
		assert.equal(formatCompactionPathList(paths), "long/parent/{alpha.ts,beta.ts}");
		assert.deepEqual(paths, ["long/parent/alpha.ts", "long/parent/beta.ts"]);
		const throwing = new Proxy([...paths], {
			get(target, key, receiver) {
				if (key === Symbol.iterator) throw new Error("post-baseline");
				return Reflect.get(target, key, receiver);
			},
		});
		assert.equal(formatCompactionPathList(throwing), paths.join("\n"));
	});
});
