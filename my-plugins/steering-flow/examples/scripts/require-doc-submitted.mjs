#!/usr/bin/env node
// argv: [DOC_KEY, tape_path]
// Returns true if tape[DOC_KEY] is a non-empty string AND the file at that path exists.
import { readFileSync, existsSync } from "node:fs";
const [docKey, tape] = process.argv.slice(2);
const t = JSON.parse(readFileSync(tape, "utf-8"));
const path = t[docKey];
if (!path || typeof path !== "string" || !path.trim()) {
	console.log("false");
	console.log(`Set ${docKey} to the document file path via save-to-steering-flow.`);
} else if (!existsSync(path)) {
	console.log("false");
	console.log(`File does not exist: ${path}. Write the document first, then set ${docKey}.`);
} else {
	console.log("true");
	console.log(`Document submitted: ${path}`);
}
