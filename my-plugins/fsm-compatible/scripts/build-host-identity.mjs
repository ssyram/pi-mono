import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  console.log('Native identity helper is only needed on macOS.');
} else {
  const directory = fileURLToPath(new URL('../.runtime/bin/', import.meta.url));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const source = fileURLToPath(new URL('../src/runtime/host-identity-macos.c', import.meta.url));
  const output = fileURLToPath(new URL('../.runtime/bin/host-identity', import.meta.url));
  const result = spawnSync('/usr/bin/cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', source, '-lproc', '-o', output], { stdio: 'inherit' });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log(`Built identity helper: ${output}`);
}
