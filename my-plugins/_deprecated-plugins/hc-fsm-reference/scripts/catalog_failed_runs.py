import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--output', default='evidence/failures-v2.json')
args = parser.parse_args()
rows = []
for path in sorted((ROOT / 'runs').glob('*/FAILURE.json')):
    run = path.parent
    failure = json.loads(path.read_text())
    manifest = json.loads((run / 'manifest.json').read_text())
    rows.append({'run': str(run.relative_to(ROOT)), 'plot': Path(manifest['plot']).name, 'mode': manifest['mode'],
        'firstError': failure['error'], 'intentional': Path(manifest['plot']).name == 'fail-fast.json',
        'cleanup': str((run / 'cleanup.json').relative_to(ROOT)),
        'tracebacks': [str(item.relative_to(ROOT)) for item in sorted(run.glob('*traceback*.txt'))],
        'goldenFrozen': (run / 'PASS.json').exists()})
result = {'failedRunsPreserved': rows, 'bootstrapBuildFailure': '.runtime/fsm-build-first-failure.log',
    'frameworkFirstTestFailure': '.runtime/framework-tests.log', 'jsonTypeFirstFailure': '.runtime/json-types-first-failure.log',
    'upstreamAttempts': ['.runtime/upstream-tests/2410317e', '.runtime/upstream-tests/0af7e767', '.runtime/upstream-tests/c527a9b8']}
path = ROOT / args.output
if not path.resolve().is_relative_to(ROOT):
    raise ValueError('failure catalog must remain inside package')
if path.exists():
    if json.loads(path.read_text()) != result:
        raise ValueError('new failure evidence exists; use a new catalog filename rather than overwrite')
else:
    with path.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
