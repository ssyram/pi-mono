#!/usr/bin/env node
// argv: [tape_path, PLAN_TEXT]
import { readFileSync, writeFileSync } from "node:fs";
const [tape, plan] = process.argv.slice(2);
if (!plan || !plan.trim()) {
	console.log("false");
	console.log("PLAN_TEXT argument is empty");
	process.exit(0);
}
const t = JSON.parse(readFileSync(tape, "utf-8"));
t.PLAN_TEXT = plan;
writeFileSync(tape, JSON.stringify(t, null, 2));
console.log("true");
console.log(`plan saved (${plan.length} chars)`);
