import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from json_equality import exact_json
DEFAULT = [
    ['plots/reference.json', 'runs/cfdc2552b', 'runs/r2fdcb283'],
    ['plots/idle-resume.json', 'runs/c5f603b8b', 'runs/r1f1658da'],
    ['plots/soft-review.json', 'runs/c504eb525', 'runs/rd0479d9f'],
]


def read(path):
    return json.loads(path.read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_pair(plot_name, collect_name, replay_name):
    plot_path, collect, replay = (ROOT / item for item in (plot_name, collect_name, replay_name))
    plot = read(plot_path)
    golden = Path(plot['golden'])
    baseline = read(golden)
    baseline_hash = sha(golden)
    require(golden.stat().st_mode & 0o222 == 0, 'golden is not read-only')
    left, right = read(collect / 'manifest.json'), read(replay / 'manifest.json')
    require(left['mode'] == 'collect' and right['mode'] == 'replay', 'run modes differ')
    require(left['plotHash'] == right['plotHash'] == baseline['plotHash'] == sha(plot_path), 'plot hashes differ')
    require(exact_json(left['behaviorHashes'], right['behaviorHashes']) and exact_json(left['behaviorHashes'], baseline['behaviorHashes']), 'behavior hashes differ')
    require(exact_json(left['binaries'], right['binaries']) and exact_json(left['binaries'], baseline['binaries']), 'binary hashes differ')
    sources = [p for p in [*(ROOT / 'src').glob('*'), ROOT / 'bin/use-plot', *(ROOT / 'workflows').glob('*.yaml')] if p.is_file()]
    actual = {str(path.relative_to(ROOT)): sha(path) for path in sources}
    require(exact_json(actual, baseline['behaviorHashes']), 'current runtime differs from frozen code')
    for name, digest in baseline['binaries'].items():
        require(sha(Path(name)) == digest, 'runtime binary changed: ' + name)
    require(left['goldenHashBefore'] is None and right['goldenHashBefore'] == baseline_hash, 'golden before hashes differ')
    sessions = []
    for run in (collect, replay):
        require(not (run / 'FAILURE.json').exists(), 'run contains latched failure')
        passed = read(run / 'PASS.json')
        state = read(run / 'state.json')
        require(passed['goldenHash'] == baseline_hash, 'golden changed')
        require(exact_json(state['receipts'], baseline['receipts']), 'receipt mismatch')
        require(exact_json(state.get('inboxes', {}), baseline['inboxes']), 'consumed message mismatch')
        require(exact_json(read(run / 'completion-observation.json'), baseline['completion']), 'completion observation mismatch')
        require(exact_json({name: actor['result'] for name, actor in state['actors'].items()}, baseline['results']), 'actor results mismatch')
        require(all(actor['done'] and actor['pending'] is None for actor in state['actors'].values()), 'unfinished actor')
        require(read(run / 'final-result.json')['message'] == baseline['results']['root'], 'final actual message mismatch')
        require(all(child['exit'] is not None for child in read(run / 'cleanup.json')['owned']), 'unreaped owned process')
        for actor, expected in baseline['tool_definitions'].items():
            require(exact_json(read(run / f'tool-definitions-{actor}.json'), expected), 'tool definition mismatch')
        sessions.append({value for name, value in state['bindings'].items() if name.startswith('session.')})
    require(not sessions[0] & sessions[1], 'sessions were reused across runs')
    require(not set(left['ports'].values()) & set(right['ports'].values()), 'ports were reused across the delivered pair')
    return {'plot': plot_name, 'collect': collect_name, 'replay': replay_name, 'golden': str(golden.relative_to(ROOT)), 'goldenSha256': baseline_hash,
            'plotSha256': baseline['plotHash'], 'receiptMatches': len(baseline['receipts']), 'consumedInboxMatches': len(baseline['inboxes']),
            'toolDefinitionMatches': {name: len(tools) for name, tools in baseline['tool_definitions'].items()},
            'hookInvocationsMatched': baseline['completion']['background']['total'], 'normalStopsMatched': len(baseline['completion']['normal_stops']),
            'completionReportsMatched': len(baseline['completion']['completion_reports']), 'result': baseline['results']['root'],
            'freshSessionIdentities': True, 'freshPorts': True, 'goldenUnchanged': True, 'allOwnedServicesReaped': True}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pair', nargs=3, action='append', metavar=('PLOT', 'COLLECT', 'REPLAY'))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    result = {'verifiedPairs': [verify_pair(*pair) for pair in args.pair or DEFAULT]}
    if args.output:
        path = args.output.resolve()
        require(path.is_relative_to(ROOT), 'evidence output must stay inside package')
        if path.exists():
            require(exact_json(read(path), result), 'existing evidence differs; refusing overwrite')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('x') as output:
                json.dump(result, output, ensure_ascii=False, indent=2)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
