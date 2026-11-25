import ast
import json
import py_compile
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
files = [*(ROOT / 'src').glob('*.py'), *(ROOT / 'scripts').glob('*.py'), *(ROOT / 'tests').glob('*.py'), ROOT / 'bin/use-plot']
for path in files:
    source = path.read_text()
    ast.parse(source, filename=str(path))
    py_compile.compile(str(path), doraise=True)
    code_lines = [line for line in source.splitlines() if line.strip() and not line.lstrip().startswith('#')]
    if len(code_lines) > 200:
        raise ValueError(f'source line limit: {path}: {len(code_lines)}')
    if path.stem in ('utils', 'helpers', 'common', 'shared'):
        raise ValueError('generic bucket module forbidden')
for path in (ROOT / 'plots').glob('*.json'):
    json.loads(path.read_text())
subprocess.run(['node', '--check', str(ROOT / 'src/hc_observer.js')], check=True)
subprocess.run(['/bin/bash', '-n', str(ROOT / 'src/hook_observer.sh')], check=True)
print(f'PASS: {len(files)} Python sources; JS/Bash syntax; plot JSON; 200-line source bound')
