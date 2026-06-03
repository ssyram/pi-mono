#!/usr/bin/env node
// argv: [FINDINGS_KEY, SIGNATURES_KEY, MIN_SIGNATURES, PHASE, tape_path]
// Verifies every finding has at least MIN_SIGNATURES distinct fresh signatures for PHASE.
import { readFileSync } from "node:fs";

const [findingsKey, signaturesKey, minRaw, phase, tapePath] = process.argv.slice(2);
const min = Number(minRaw);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
const findings = Array.isArray(tape[findingsKey]) ? tape[findingsKey] : [];
const signatures = tape[signaturesKey] && typeof tape[signaturesKey] === "object" ? tape[signaturesKey] : {};

if (!Number.isInteger(min) || min <= 0) {
	console.log("false");
	console.log(`Invalid minimum signature count: ${minRaw}`);
	process.exit(0);
}

if (findings.length === 0) {
	console.log("false");
	console.log(`${findingsKey} must be a non-empty array of finding ids.`);
	process.exit(0);
}

const missing = [];
for (const finding of findings) {
	const findingId = String(finding);
	const entries = Array.isArray(signatures[findingId]) ? signatures[findingId] : [];
	const freshActors = new Set();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		if (entry.phase !== phase) continue;
		if (entry.fresh !== true) continue;
		if (typeof entry.actor_id !== "string" || entry.actor_id.trim() === "") continue;
		if (typeof entry.comment !== "string" || entry.comment.trim() === "") continue;
		freshActors.add(entry.actor_id);
	}
	if (freshActors.size < min) {
		missing.push(`${findingId}: ${freshActors.size}/${min}`);
	}
}

if (missing.length === 0) {
	console.log("true");
	console.log(`${phase} signatures cover ${findings.length} findings with >=${min} fresh actors each.`);
} else {
	console.log("false");
	console.log(`${phase} signature coverage missing: ${missing.join(", ")}`);
}
