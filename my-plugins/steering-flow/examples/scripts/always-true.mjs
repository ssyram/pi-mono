#!/usr/bin/env node
// argv: [MESSAGE, ...extra_llm_args]  (no ${$TAPE_FILE} in args)
const [msg] = process.argv.slice(2);
console.log("true");
console.log(msg || "ok");
