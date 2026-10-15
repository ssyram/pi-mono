import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractModifierContext } from "./modifier-context.js";
import { parseReferenceOccurrences } from "./reference-occurrences.js";

describe("reference modifier syntax", () => {
	it("accepts zero or arbitrary horizontal whitespace and both separators", () => {
		for (const gap of ["", " ", "   ", "\t", " \t  \t"]) {
			for (const separator of [":", "::"]) {
				for (const operation of ["print", "path"]) {
					const input = `use /skill:alpha${gap}${separator}${operation}!`;
					assert.deepEqual(parseReferenceOccurrences(input), [
						{
							start: 4,
							end: input.length - 1,
							reference: "/skill:alpha",
							operation,
							escapeIndex: null,
						},
					]);
				}
			}
		}
	});

	it("keeps original indices, Unicode and adjacent references", () => {
		const text = "中文 /a:print,/b:path。";
		const matches = parseReferenceOccurrences(text);
		assert.deepEqual(
			matches.map((match) => text.slice(match.start, match.end)),
			["/a:print", "/b:path"],
		);
		assert.ok(matches[0]!.end <= matches[1]!.start);
	});

	it("recognizes a single explicit escape and preserves its index", () => {
		for (const gap of ["", " ", "\t  "]) {
			for (const separator of [":", "::"]) {
				const text = `/name${gap}\\${separator}print`;
				const match = parseReferenceOccurrences(text)[0]!;
				assert.equal(match.escapeIndex, 5 + gap.length);
				assert.equal(text[match.escapeIndex!], "\\");
			}
		}
	});

	it("parses a bare escaped separator as a pure escape occurrence", () => {
		const matches = parseReferenceOccurrences("x /a \\:rest");
		assert.deepEqual(matches, [{ start: 2, end: 7, reference: "/a", operation: null, escapeIndex: 5 }]);
		assert.equal(parseReferenceOccurrences("x /a\\:: tail")[0]?.operation, null);
	});

	it("rejects incomplete operations, paths, URLs and newline associations", () => {
		for (const text of [
			"/a:printer",
			"/a::printable",
			"/a:print/child",
			"/a:print:other",
			"/a :unknown",
			"/a\n:print",
			"/a\r:print",
			"https://a:print",
			"src/a:print",
			"/src/a:print",
			"x/a:print",
		])
			assert.deepEqual(parseReferenceOccurrences(text), [], text);
	});

	it("accepts prose boundaries and does not exempt quoted examples", () => {
		for (const text of ["(/a:print)", "`/a:path`", '"/a:print"', "use=/a:path", "示例，/a:print。"])
			assert.equal(parseReferenceOccurrences(text).length, 1, text);
	});
});

describe("modifier cursor context", () => {
	it("recognizes each spacing/separator form and preserves the operation prefix", () => {
		for (const gap of ["", " ", "\t  "]) {
			for (const separator of [":", "::"]) {
				const text = `use /prompt:alpha${gap}${separator}pr`;
				const context = extractModifierContext([text], 0, text.length)!;
				assert.equal(context.reference, "/prompt:alpha");
				assert.equal(context.start, 17 + gap.length);
				assert.equal(context.prefix, `${separator}pr`);
				assert.equal(context.fragment, "pr");
				assert.equal(context.escaped, false);
			}
		}
	});

	it("distinguishes a kind prefix from an operation", () => {
		for (const text of ["/skill:", "/prompt:", "/SKILL:qp", "/skill:name"])
			assert.equal(extractModifierContext([text], 0, text.length), null, text);
		assert.equal(extractModifierContext(["use /skill:name:"], 0, 16)?.reference, "/skill:name");
	});

	it("recognizes escape prefixes and ignores text right of cursor", () => {
		const text = "use /a \\:pr remainder";
		assert.deepEqual(extractModifierContext([text], 0, 11), {
			reference: "/a",
			start: 7,
			prefix: "\\:pr",
			separator: ":",
			escaped: true,
			fragment: "pr",
		});
	});

	it("does not claim standalone punctuation, paths or resources on another line", () => {
		for (const text of [":", "hello :", "src/a :", "https://a :", "/a :print "])
			assert.equal(extractModifierContext([text], 0, text.length), null, text);
		assert.equal(extractModifierContext(["/a", ":"], 1, 1), null);
		for (const lines of [["/a :"], ["  /a ::p"], ["", "\t/a \\:p"]]) {
			const cursorLine = lines.length - 1;
			assert.equal(extractModifierContext(lines, cursorLine, lines[cursorLine]!.length), null, lines.join("|"));
		}
	});
});
