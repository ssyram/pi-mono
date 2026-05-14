#!/usr/bin/env node
// argv: [CAPABILITY_KEY, FINDINGS_KEY, SIGNATURES_KEY, PHASE, ACTOR_ID, COMMENT, tape_path]
// Appends a fresh signature entry for every finding in FINDINGS_KEY.
import { readFileSync, writeFileSync } from "node:fs";

const [capabilityKey, findingsKey, signaturesKey, phase, actorId, comment, tapePath] = process.argv.slice(2);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
const capability = tape[capabilityKey];
if (!(capability === true || capability === 1 || capability === "1" || capability === "true" || capability === "available")) {
	console.log("false");
	console.log(`${capabilityKey} must confirm fresh-agent capability before signing.`);
	process.exit(0);
}

const findings = Array.isArray(tape[findingsKey]) ? tape[findingsKey] : [];
if (findings.length === 0) {
	console.log("false");
	console.log(`${findingsKey} must be a non-empty array.`);
	process.exit(0);
}
if (!actorId || !actorId.trim()) {
	console.log("false");
	console.log("ACTOR_ID argument is empty.");
	process.exit(0);
}
if (!comment || !comment.trim()) {
	console.log("false");
	console.log("COMMENT argument is empty.");
	process.exit(0);
}

const signatures = tape[signaturesKey] && typeof tape[signaturesKey] === "object" && !Array.isArray(tape[signaturesKey]) ? tape[signaturesKey] : {};
for (const finding of findings) {
	const findingId = String(finding);
	const entries = Array.isArray(signatures[findingId]) ? signatures[findingId] : [];
	entries.push({ phase, actor_id: actorId, fresh: true, comment });
	signatures[findingId] = entries;
}
tape[signaturesKey] = signatures;
writeFileSync(tapePath, JSON.stringify(tape, null, 2));
console.log("true");
console.log(`${actorId} signed ${findings.length} findings for ${phase}.`);
