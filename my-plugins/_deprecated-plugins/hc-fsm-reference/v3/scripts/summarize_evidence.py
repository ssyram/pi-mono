import hashlib
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from json_equality import exact_json

PAIRS = [('semantic-stop', 'c461ff312', 'rf78a9392'), ('native-agents', 'c73ea9536', 'rbef4ccca'), ('semantic-wait', 'cfa70cb92', 'r41ac8566')]


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


results, raw_index = [], {}
for name, collect, replay in PAIRS:
    plot_path = ROOT / 'plots' / (name + '.json')
    plot = read(plot_path)
    golden_path = Path(plot['golden'])
    golden = read(golden_path)
    source_paths = [path for path in [*(ROOT / 'src').glob('*'), ROOT / 'bin/use-plot', *(ROOT / 'workflows').glob('*.yaml')] if path.is_file()]
    current_sources = {str(path.relative_to(ROOT)): sha(path) for path in source_paths}
    if not exact_json(golden['behaviorHashes'], current_sources) or golden['plotHash'] != sha(plot_path):
        raise ValueError('v3 frozen source/plot changed')
    for path, digest in golden['binaries'].items():
        if sha(Path(path)) != digest:
            raise ValueError('pinned binary changed')
    sessions, ports = [], []
    for run_name in (collect, replay):
        run = ROOT / 'runs' / run_name
        passed, manifest, state = read(run / 'PASS.json'), read(run / 'manifest.json'), read(run / 'state.json')
        if (run / 'FAILURE.json').exists() or manifest['stopAnalysis'] != '1':
            raise ValueError('failed or analysis-disabled accepted run')
        if not exact_json(state['receipts'], golden['receipts']) or not exact_json(state.get('stop_phases', {}), golden['stop_phases']) or not exact_json(state.get('requests', {}), golden['requests']):
            raise ValueError('receipts/real Stop requests/phases differ')
        if not exact_json(state.get('api_observations', {}), golden['api_observations']) or not exact_json(state.get('inboxes', {}), golden['inboxes']):
            raise ValueError('busy/public-root/consumption observation differs')
        if not exact_json(read(run / 'completion-observation.json'), golden['completion']):
            raise ValueError('complete protocol observation differs')
        if not exact_json(manifest['behaviorHashes'], golden['behaviorHashes']) or not exact_json(manifest['binaries'], golden['binaries']) or manifest['plotHash'] != golden['plotHash']:
            raise ValueError('run input fingerprints differ')
        if passed['goldenHash'] != sha(golden_path) or golden_path.stat().st_mode & 0o222:
            raise ValueError('golden changed or not read-only')
        if not all(actor['done'] and actor['pending'] is None for actor in state['actors'].values()):
            raise ValueError('actor incomplete')
        if not all(child['exit'] is not None for child in read(run / 'cleanup.json')['owned']):
            raise ValueError('owned service not reaped')
        if read(run / 'final-result.json')['message'] != golden['results']['root']:
            raise ValueError('actual final result changed')
        sessions.append({value for key, value in state['bindings'].items() if key.startswith('session.')})
        ports.append(set(manifest['ports'].values()))
        files = {path for path in run.iterdir() if path.is_file() and path.suffix in ('.json', '.jsonl', '.log', '.txt')}
        for directory in ('http', 'captures', 'model-inputs', 'hooks', 'fsm-states', 'hc-tool-parts', 'api-observations'):
            files.update(path for path in (run / directory).glob('*') if path.is_file())
        files.update((run / 'tmp').glob('fsm-watch-*/daemon-*/session-*/index.json'))
        files.update((run / 'tmp').glob('fsm-watch-*/daemon-*/session-*/logs/*.jsonl'))
        raw_index[run_name] = [{'path': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size, 'sha256': sha(path)} for path in sorted(files)]
    if sessions[0] & sessions[1] or ports[0] & ports[1]:
        raise ValueError('fresh pair reused identities/ports')
    results.append({'case': name, 'collect': collect, 'replay': replay, 'golden': str(golden_path.relative_to(ROOT)), 'goldenSha256': sha(golden_path),
        'plotSha256': sha(plot_path), 'actionsMatched': len(golden['receipts']), 'toolCallsMatched': sum(step.get('kind') != 'pause' for actor in plot['actors'].values() for step in actor['steps']),
        'hookInvocationsMatched': golden['completion']['background']['total'], 'semanticStopPhases': len(golden['stop_phases']),
        'sameModelStopRequests': len(golden['requests']), 'normalFinalStops': len(golden['completion']['normal_stops']),
        'nativeCompletionReports': len(golden['completion']['completion_reports']), 'expectedCancellationErrors': len(golden['completion']['cancelled_runs']['assistants']),
        'actualResult': golden['results']['root'], 'freshSessionsAndPorts': True, 'goldenUnchanged': True})
failures = [{'run': path.parent.name, 'firstError': read(path)['error'], 'noGolden': not (path.parent / 'PASS.json').exists()} for path in sorted((ROOT / 'runs').glob('*/FAILURE.json'))]
summary = {'pairs': results, 'failuresPreserved': failures, 'rawFilesIndexed': sum(len(files) for files in raw_index.values()), 'secretExclusion': 'auth.token and Authorization headers are not indexed or printed'}
for filename, value in [('results.json', summary), ('raw-index.json', raw_index)]:
    path = ROOT / 'evidence' / filename
    if path.exists():
        if not exact_json(read(path), value):
            raise ValueError('existing evidence differs; refusing overwrite')
    else:
        with path.open('x') as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
print(json.dumps(summary, ensure_ascii=False, indent=2))
