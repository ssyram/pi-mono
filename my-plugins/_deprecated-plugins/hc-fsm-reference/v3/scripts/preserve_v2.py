import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
paths = [path for path in [*(ROOT / 'src').glob('*'), ROOT / 'bin/use-plot', *(ROOT / 'workflows').glob('*.yaml')] if path.is_file()]
paths += [ROOT / 'golden' / name for name in ('reference-v2.json', 'idle-resume-v2.json', 'soft-review-v2.json')]
record = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
path = ROOT / 'v3/evidence/v2-preserved.json'
if path.exists():
    if json.loads(path.read_text()) != record:
        raise ValueError('existing v2 source/input/golden changed')
else:
    path.write_text(json.dumps(record, indent=2) + '\n')
print(f'Preserved v2: {len(record)} exact source/input/golden hashes; original entry remains bin/use-plot + src/run_experiment.py')
