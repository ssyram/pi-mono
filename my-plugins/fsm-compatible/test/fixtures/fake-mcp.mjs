import { createInterface } from 'node:readline';
const mode = process.argv[2] ?? 'normal';
const tool = (name) => ({ name, description: name, inputSchema: { type: 'object', properties: { value: { type: 'string' } }, additionalProperties: false } });
const lines = createInterface({ input: process.stdin });
function respond(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`); }
lines.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') { respond(msg.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } }); return; }
  if (msg.method === 'tools/list') {
    respond(msg.id, msg.params.cursor ? { tools: [tool('fsm_set_var')] } : { tools: [tool('fsm_get_state')], nextCursor: 'page2' }); return;
  }
  if (msg.method !== 'tools/call') return;
  if (mode === 'stall') return;
  if (mode === 'wrong-id') { respond(msg.id + 999, {}); return; }
  if (mode === 'progress') process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: msg.params._meta?.progressToken, progress: 1 } })}\n`);
  const output = { content: [{ type: 'text', text: JSON.stringify(msg.params.arguments) }], structuredContent: { tool: msg.params.name }, isError: false };
  if (mode === 'delay') setTimeout(() => respond(msg.id, output), 30);
  else respond(msg.id, output);
});
