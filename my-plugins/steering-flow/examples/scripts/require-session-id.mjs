#!/usr/bin/env node
// argv: [EXPECTED_SESSION_ID, tape_path]
import { readFileSync } from "node:fs";

const [expectedSessionId, tapePath] = process.argv.slice(2);
const tape = JSON.parse(readFileSync(tapePath, "utf-8"));
if (tape.EXPECTED_SESSION_ID !== expectedSessionId) {
	console.log("false");
	console.log(`expected session id ${tape.EXPECTED_SESSION_ID}, got ${expectedSessionId}`);
	process.exit(0);
}
console.log("true");
console.log(`session id matched: ${expectedSessionId}`);
