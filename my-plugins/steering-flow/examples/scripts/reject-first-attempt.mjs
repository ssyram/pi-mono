#!/usr/bin/env node
// argv: [tape_path]
// First call records an A->B attempt and rejects; later calls pass.
import { readFileSync, writeFileSync } from "node:fs";

const [tapePath] = process.argv.slice(2);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
const attempts = Number(tape.A_TO_B_ATTEMPTS ?? 0) + 1;
tape.A_TO_B_ATTEMPTS = attempts;
writeFileSync(tapePath, JSON.stringify(tape, null, 2));

if (attempts === 1) {
	console.log("false");
	console.log("first A->B attempt recorded; retry now that tape has A_TO_B_ATTEMPTS=1");
} else {
	console.log("true");
	console.log(`A->B accepted on attempt ${attempts}`);
}
