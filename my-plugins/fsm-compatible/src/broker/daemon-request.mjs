import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { resolve } from 'node:path';

const limit = 1024 * 1024;
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (Buffer.byteLength(input) > limit) throw new Error('input-limit');
  }
  const payload = JSON.parse(input);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('bad-input');
  const allowed = new Map([
    ['/health', 'GET'], ['/capabilities', 'GET'], ['/session/source', 'GET'], ['/actors', 'GET'],
    ['/evidence/collect', 'POST'], ['/evidence/live-work', 'POST'], ['/stop-reset', 'POST'],
    ['/session/register', 'POST'], ['/identity/acquire', 'POST'], ['/actor/acquire', 'POST'], ['/evidence/source-auth', 'POST'],
    ['/check-permission', 'POST'], ['/stop-check', 'POST'], ['/gate/suppress', 'POST'], ['/gate/release', 'POST'],
  ]);
  if (typeof payload.dataDir !== 'string' || typeof payload.path !== 'string' || typeof payload.method !== 'string'
      || !Number.isFinite(payload.deadline) || payload.deadline <= Date.now()) throw new Error('bad-input');
  const url = new URL(payload.path, 'http://localhost');
  if (url.origin !== 'http://localhost' || allowed.get(url.pathname) !== payload.method || url.hash) throw new Error('bad-route');
  if (url.pathname === '/session/source') {
    if ([...url.searchParams.keys()].length !== 1 || !url.searchParams.get('session')) throw new Error('bad-query');
  } else if (url.search) throw new Error('bad-query');
  const dataDir = resolve(payload.dataDir);
  const token = (await readFile(resolve(dataDir, 'auth.token'), 'utf8')).trim();

  // Identity bridge: acquire the FSM identity slot before the real request,
  // so the daemon resolves this process's PID to the correct session/agent.
  if (payload.identity) {
    const allowedIdentity = '/identity/acquire';
    if (allowedIdentity !== '/identity/acquire') throw new Error('bad route');
    await new Promise((accept, reject) => {
      const body = JSON.stringify(payload.identity);
      const req = request({ socketPath: resolve(dataDir, 'server.sock'), path: allowedIdentity,
        method: 'POST', headers: { 'x-fsm-auth': token, 'content-type': 'application/json' } });
      const timer = setTimeout(() => req.destroy(new Error('deadline')), payload.deadline - Date.now());
      timer.unref();
      req.on('error', reject);
      req.on('close', () => clearTimeout(timer));
      req.on('response', (res) => { res.resume(); res.on('end', accept); });
      req.end(body);
    });
  }
  const body = payload.method === 'POST' ? JSON.stringify(payload.body) : '';
  if (body === undefined || Buffer.byteLength(body) > limit || !token) throw new Error('bad-input');
  const response = await new Promise((accept, reject) => {
    const req = request({ socketPath: resolve(dataDir, 'server.sock'), path: `${url.pathname}${url.search}`,
      method: payload.method, headers: { 'x-fsm-auth': token, 'content-type': 'application/json' } });
    const timer = setTimeout(() => req.destroy(new Error('deadline')), payload.deadline - Date.now());
    timer.unref();
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.on('response', (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > limit) { req.destroy(new Error('body-limit')); res.destroy(); }
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('aborted')));
      res.on('end', () => {
        try { accept({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { reject(new Error('bad-json')); }
      });
    });
    req.end(body);
  });
  process.stdout.write(`${JSON.stringify(response)}\n`);
} catch {
  process.exitCode = 1;
}
