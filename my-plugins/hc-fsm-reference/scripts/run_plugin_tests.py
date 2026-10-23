import json
import subprocess
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
run = ROOT / '.runtime/plugin-tests' / uuid4().hex[:8]
run.mkdir(parents=True)
(run / 'home').mkdir()
(ROOT / '.t').mkdir(exist_ok=True)
env = {'HOME': str(run / 'home'), 'TMPDIR': str(ROOT / '.t'), 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin'}
command = ['/opt/homebrew/bin/bun', 'test', str(ROOT / '.runtime/fsm-src/opencode-plugin/fsm-plugin.test.js')]
with (run / 'output.log').open('x') as log:
    result = subprocess.run(command, env=env, cwd=ROOT / '.runtime/fsm-src', stdout=log, stderr=subprocess.STDOUT)
(run / 'result.json').write_text(json.dumps({'command': command, 'exit': result.returncode,
    'bunVersion': subprocess.check_output(['/opt/homebrew/bin/bun', '--version']).decode().strip()}, indent=2))
print(run)
raise SystemExit(result.returncode)
