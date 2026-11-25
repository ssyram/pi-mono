import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from completion_observation import completion_observation
from bootstrap_roots import bootstrap_roots
from golden_baseline import freeze, verify_inputs
from json_equality import exact_json
from model_proxy import start_proxy
from plot_engine import latch, load, save, settle_pending_events
from plot_validation import validate_plot
from run_environment import ROOT, FSM, HC, MOCK, configuration, environment
from run_processes import OwnedProcesses, http, port, wait_http


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('plot')
    parser.add_argument('--collect', action='store_true')
    parser.add_argument('--diagnostic', action='store_true')
    parser.add_argument('--timeout', type=int, default=240)
    args = parser.parse_args()
    plot_path = Path(args.plot).resolve()
    plot = json.loads(plot_path.read_text())
    validate_plot(plot)
    golden = Path(plot['golden'])
    before = digest(golden) if golden.exists() else None
    if args.collect and golden.exists():
        raise ValueError('collect refuses to overwrite existing golden')
    if not args.collect and not golden.exists():
        raise ValueError('replay requires frozen golden')
    label = ('c' if args.collect else 'r') + uuid4().hex[:8]
    run = ROOT / 'runs' / label
    run.mkdir(parents=True)
    env = environment(run)
    mock_port, hc_port = port(), port()
    proxy = start_proxy(run, mock_port, plot, 'collect' if args.collect else 'replay')
    env['PLOT_HC_PORT'] = str(hc_port)
    config = configuration(run, proxy.server_port)
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps(config)
    bindings = {'run': str(run), 'work': str(run / 'work'), 'package': str(ROOT)}
    bindings.update(plot.get('bindings', {}))
    env['PLOT_BINDINGS'] = json.dumps(bindings)
    manifest = {'plot': str(plot_path), 'plotHash': digest(plot_path), 'mode': 'collect' if args.collect else 'replay',
                'stopAnalysis': env['FSM_STOP_ANALYSIS'], 'goldenHashBefore': before, 'started': datetime.now(timezone.utc).isoformat(), 'run': str(run), 'ports': {'hc': hc_port, 'mock': mock_port, 'proxy': proxy.server_port},
                'binaries': {str(p): digest(p) for p in (HC, MOCK, FSM / 'mcp-server-fsm', FSM / 'mcp-server-fsm-client', FSM / 'mcp-server-fsm-hook', ROOT / '.runtime/tool-bin/rg')},
                'behaviorHashes': {str(p.relative_to(ROOT)): digest(p) for p in sorted([*(ROOT / 'src').glob('*'), ROOT / 'bin/use-plot', *(ROOT / 'workflows').glob('*.yaml')]) if p.is_file()}}
    save(run / 'manifest.json', manifest)
    save(run / 'config.json', config)
    owned = OwnedProcesses(run, env)
    success = False
    try:
        if not args.collect:
            verify_inputs(load(golden, {}), manifest)
        daemon = owned.start('fsm', [str(FSM / 'mcp-server-fsm'), 'serve', '--data-dir', str(run / 'fsm')])
        deadline = time.monotonic() + 30
        while not (run / 'fsm/server.sock').exists():
            if daemon.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('FSM failed startup')
            time.sleep(0.1)
        for yaml in plot.get('workflows', []):
            result = subprocess.run([str(FSM / 'mcp-server-fsm'), 'register-skill', str(ROOT / yaml)], env=env, capture_output=True, cwd=run / 'work')
            (run / (Path(yaml).stem + '.registration.txt')).write_bytes(result.stdout + result.stderr)
            result.check_returncode()
        result = subprocess.run([str(FSM / 'mcp-server-fsm'), 'capabilities'], env=env, capture_output=True, cwd=run / 'work', check=True)
        (run / 'capabilities.json').write_bytes(result.stdout)
        mock = owned.start('mock', [str(MOCK), '--port', str(mock_port), '--mounts-file', str(run / 'mounts.json'), '--capture-dir', str(run / 'captures')])
        wait_http(mock_port, '/__admin/scripts', [mock])
        command = shlex.join([str(ROOT / 'bin/use-plot'), str(plot_path), *(['--collect'] if args.collect else [])])
        save(run / 'mount.json', http(mock_port, '/__admin/scripts', {'name': 'plot', 'command': command}))
        hc = owned.start('hc', [str(HC), 'serve', '--port', str(hc_port), '--hostname', '127.0.0.1', '--print-logs', '--log-level', 'DEBUG'])
        wait_http(hc_port, '/global/health', [hc])
        session = bootstrap_roots(run, hc_port, plot, bindings, save)
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            if (run / 'FAILURE.json').exists():
                raise RuntimeError((run / 'FAILURE.json').read_text())
            if any(child.poll() is not None for child in owned.children):
                raise RuntimeError('owned service unexpectedly exited')
            settle_pending_events(plot, run, 'collect' if args.collect else 'replay')
            state = load(run / 'state.json', {})
            actors = state.get('actors', {})
            if all(actors.get(actor, {}).get('done') for actor in plot['actors']):
                messages = http(hc_port, f"/session/{session['id']}/message")
                texts = [part['text'] for message in messages for part in message.get('parts', []) if part['type'] == 'text']
                expected = actors['root']['result']
                if expected in texts:
                    save(run / 'root-messages.json', messages)
                    save(run / 'final-result.json', {'message': expected})
                    break
            time.sleep(0.1)
        else:
            raise TimeoutError('HC experiment deadline exceeded')
        time.sleep(1)
        state = load(run / 'state.json', {})
        expected_count = sum(len(spec['steps']) for spec in plot['actors'].values())
        if len(state['receipts']) != expected_count:
            raise ValueError('receipt completeness failed')
        for command in ('history', 'identities'):
            result = subprocess.run([str(FSM / 'mcp-server-fsm'), 'store', command], env=env, capture_output=True, cwd=run / 'work', check=True)
            suffix = 'json' if command == 'identities' else 'jsonl'
            (run / f'fsm-{command}.{suffix}').write_bytes(result.stdout)
        result = subprocess.run([str(FSM / 'mcp-server-fsm'), 'logs', '--last', '10000'], env=env, capture_output=True, cwd=run / 'work', check=True)
        (run / 'fsm-logs.jsonl').write_bytes(result.stdout)
        observed = completion_observation(run, hc_port, plot, state)
        if (run / 'FAILURE.json').exists() or proxy.inflight:
            raise ValueError('completion has a latched failure or in-flight model request')
        if proxy.peak_inflight < plot.get('observations', {}).get('minimum_model_concurrency', 1):
            raise ValueError('declared model concurrency was not observed')
        save(run / 'model-concurrency.json', {'peak': proxy.peak_inflight, 'final_inflight': proxy.inflight})
        baseline = {'plotHash': manifest['plotHash'], 'behaviorHashes': manifest['behaviorHashes'], 'receipts': state['receipts'],
                    'results': {actor: actors[actor]['result'] for actor in actors}, 'inboxes': state.get('inboxes', {}), 'stop_phases': state.get('stop_phases', {}), 'requests': state.get('requests', {}), 'api_observations': state.get('api_observations', {}), 'binaries': manifest['binaries'], **observed}
        if args.collect and not args.diagnostic:
            freeze(golden, baseline, run.name)
        elif not args.collect:
            if before != digest(golden):
                raise ValueError('golden changed during replay')
            stored = load(golden, {})
            if not exact_json(stored, baseline):
                save(run / 'postflight-mismatch.json', {'expected': stored, 'actual': baseline})
                raise ValueError('postflight baseline mismatch')
        success = True
        save(run / ('DIAGNOSTIC.json' if args.diagnostic else 'PASS.json'), {'receipts': expected_count, 'result': actors['root']['result'], 'goldenHash': digest(golden) if golden.exists() else None})
    except Exception as error:
        (run / 'failure-traceback.txt').write_text(traceback.format_exc())
        latch(run, error)
        print(f'FAILED: {error}', file=sys.stderr)
    finally:
        owned.close()
        proxy.shutdown()
        save(run / 'cleanup.json', {'owned': [{'pid': child.pid, 'exit': child.returncode} for child in owned.children]})
        print(run)
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(main())
