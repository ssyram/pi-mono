import json
import os
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
TOOLCHAIN = Path('/Users/ssyram/.rustup/toolchains/stable-aarch64-apple-darwin/bin')
RUN = RUNTIME / 'upstream-tests' / uuid4().hex[:8]
RUN.mkdir(parents=True)
HOME = RUN / 'home'
for name in ('tmp', 'data', 'config', 'cache', 'state'):
    (HOME / name).mkdir(parents=True, exist_ok=True)
(ROOT / '.t').mkdir(exist_ok=True)
env = {'HOME': str(HOME), 'TMPDIR': str(ROOT / '.t'), 'CARGO_HOME': str(RUNTIME / 'cargo-home'),
       'PATH': str(TOOLCHAIN) + ':/usr/bin:/bin:/usr/sbin:/sbin', 'RUSTC': str(TOOLCHAIN / 'rustc'),
       'RUSTDOC': str(TOOLCHAIN / 'rustdoc'), 'XDG_DATA_HOME': str(HOME / 'data'),
       'XDG_CONFIG_HOME': str(HOME / 'config'), 'XDG_CACHE_HOME': str(HOME / 'cache'),
       'XDG_STATE_HOME': str(HOME / 'state'), 'FSM_REQUIRE_PROCESS_IDENTITY_SOCKET': '1', 'FSM_REQUIRE_RELEASE_BINS': '1'}
commands = [
    ('mock-build', [str(TOOLCHAIN / 'cargo'), 'build', '--frozen', '--release', '--manifest-path', str(RUNTIME / 'mock-src/Cargo.toml')]),
    ('fsm-upstream', [str(TOOLCHAIN / 'cargo'), 'test', '--frozen', '--workspace', '--no-fail-fast', '--manifest-path', str(RUNTIME / 'fsm-src/Cargo.toml')]),
]
results = []
for label, command in commands:
    print('Executing ' + label, flush=True)
    with (RUN / (label + '.log')).open('xb') as log:
        result = subprocess.run(command, cwd=RUNTIME, env=env, stdout=log, stderr=subprocess.STDOUT)
    results.append({'label': label, 'command': command, 'exit': result.returncode})
(RUN / 'results.json').write_text(json.dumps(results, indent=2))
print(RUN)
raise SystemExit(1 if any(result['exit'] for result in results) else 0)
