import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNS = ['cfdc2552b', 'r2fdcb283', 'c5f603b8b', 'r1f1658da', 'c504eb525', 'rd0479d9f', 'c0251d48c']
DIRECTORIES = ['http', 'captures', 'model-inputs', 'hooks', 'fsm-states', 'hc-tool-parts']
result = {'runs': []}
for name in RUNS:
    run = ROOT / 'runs' / name
    files = {path for path in run.iterdir() if path.is_file() and path.suffix in ('.json', '.jsonl', '.log', '.txt')}
    for directory in DIRECTORIES:
        files.update(path for path in (run / directory).glob('*') if path.is_file())
    files.update((run / 'tmp').glob('fsm-watch-*/daemon-*/session-*/index.json'))
    files.update((run / 'tmp').glob('fsm-watch-*/daemon-*/session-*/logs/*.jsonl'))
    records = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
               for path in sorted(files)]
    events = [json.loads(line) for line in (run / 'hc-tools.jsonl').read_text().splitlines()]
    error_count = sum(event['kind'] == 'event' and event['input']['type'] == 'session.error' for event in events)
    if name != 'c0251d48c' and error_count:
        raise ValueError('unexpected HC session.error in accepted run')
    result['runs'].append({'run': 'runs/' + name, 'hcSessionErrorEvents': error_count, 'files': records})
result['excludedSecrets'] = ['fsm/auth.token and credentials are intentionally not indexed or printed', 'raw HTTP capture stores body, never Authorization headers']
path = ROOT / 'evidence/raw-index-v2.json'
if path.exists():
    if json.loads(path.read_text()) != result:
        raise ValueError('raw evidence changed; refusing to overwrite index')
else:
    with path.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
print(f'Indexed {sum(len(run["files"]) for run in result["runs"])} raw evidence files across {len(RUNS)} runs; no secrets copied')
