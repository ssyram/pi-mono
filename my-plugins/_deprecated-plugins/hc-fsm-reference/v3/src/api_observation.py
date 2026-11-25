import json
import os
import re
import subprocess
import time
from pathlib import Path
from json_equality import exact_json
from plot_contract import assert_expectations, expand, normalize
from run_processes import http


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def descendant(pid, parent):
    seen = set()
    while pid > 1 and pid not in seen:
        if pid == parent:
            return True
        seen.add(pid)
        result = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'ppid='], capture_output=True, text=True)
        if result.returncode or not result.stdout.strip().isdigit():
            return False
        pid = int(result.stdout.strip())
    return False


def observe_api(run, actor, index, spec, plot, state, mode):
    bindings = state['bindings']
    port = int(os.environ['PLOT_HC_PORT'])
    key = f'{actor}/{index:03d}'
    prefix = key.replace('/', '-')
    owner = json.loads((run / 'hc.process.json').read_text())['pid']
    bindings['process.hc.pid'] = owner
    deadline = time.monotonic() + spec.get('wait_seconds', 10)
    while True:
        statuses = http(port, '/session/status')
        if type(statuses) is not dict:
            raise ValueError('HC status must be an object')
        idle = all(bindings['session.' + name] not in statuses for name in spec.get('idle', []))
        dead = all(not alive(bindings['pid.' + name]) for name in spec.get('dead', []))
        if idle and dead:
            break
        if time.monotonic() >= deadline:
            raise TimeoutError('declared post-cancel idle/dead observation did not settle')
        time.sleep(0.05)
    (run / 'api-observations' / f'{prefix}-status.json').write_text(json.dumps(statuses, indent=2))
    result = {'busy': {}, 'idle': {}, 'identities': {}, 'dead': {}}
    rules = []
    for item in spec.get('busy', []):
        name, call = item['actor'], item['call']
        session = bindings['session.' + name]
        if statuses.get(session) != {'type': 'busy'}:
            raise ValueError(f'{name} is not genuinely busy')
        messages = http(port, f'/session/{session}/message')
        parts = [part for message in messages for part in message['parts'] if part['type'] == 'tool' and part['callID'] == call]
        if len(parts) != 1 or parts[0]['state']['status'] != 'running':
            raise ValueError('expected unique actually running tool at cancellation boundary')
        part = parts[0]
        number = int(call.rsplit('_', 1)[1])
        declared = plot['actors'][name]['steps'][number]
        if call != f'plot_{name}_{number:03d}' or part['tool'] != declared['tool'] or not exact_json(part['state']['input'], expand(declared['arguments'], bindings)):
            raise ValueError('running tool identity/input changed')
        (run / 'api-observations' / f'{prefix}-{name}-running.json').write_text(json.dumps(part, indent=2))
        assert_expectations(part, [{'path': '/id', 'regex': '^(prt_[A-Za-z0-9]+)$', 'bind': f'part.{name}.{number}'},
            {'path': '/messageID', 'regex': '^(msg_[A-Za-z0-9]+)$', 'bind': f'message.{name}.{number}'}], bindings)
        timing = part['state']['time']
        if type(timing['start']) is not int or 'end' in timing:
            raise ValueError('running part has invalid timing')
        timing['start'] = '<running:start>'
        pid_text = Path(expand(item['pid_file'], bindings)).read_text().strip()
        if not re.fullmatch('[1-9][0-9]*', pid_text):
            raise ValueError('actual busy process PID is malformed')
        pid = int(pid_text)
        if pid == owner or not alive(pid) or not descendant(pid, owner):
            raise ValueError('busy PID is not an alive descendant of owned HC')
        bindings['pid.' + name] = pid
        result['busy'][name] = {'status': statuses[session], 'part': part, 'pid': pid, 'owner': owner}
        rules += [{'path': f'/busy/{name}/pid', 'kind': 'binding', 'name': 'pid.' + name},
                  {'path': f'/busy/{name}/owner', 'kind': 'binding', 'name': 'process.hc.pid'}]
    for name in spec.get('idle', []):
        result['idle'][name] = {'nonidle_entry_present': bindings['session.' + name] in statuses}
    for name, expected in spec.get('identities', {}).items():
        info = http(port, f"/session/{bindings['session.' + name]}")
        (run / 'api-observations' / f'{prefix}-{name}-session.json').write_text(json.dumps(info, indent=2))
        parent = expected.get('parent')
        if info['id'] != bindings['session.' + name] or info.get('parentID') != (bindings['session.' + parent] if parent else None) or ('parentID' in info) != (parent is not None):
            raise ValueError('public session identity/tree linkage changed')
        if info['agent'] != expected['agent']:
            raise ValueError('stored agent profile was not retained')
        result['identities'][name] = {field: info.get(field) for field in ('id', 'parentID', 'agent')}
    for name in spec.get('dead', []):
        result['dead'][name] = {'pid': bindings['pid.' + name], 'alive': False}
        rules.append({'path': f'/dead/{name}/pid', 'kind': 'binding', 'name': 'pid.' + name})
    dynamic = [name for name in bindings if name.startswith(('part.', 'message.'))]
    value = normalize(result, bindings, rules, [*plot['normalize_bindings'], *dynamic])
    if mode != 'collect' and not exact_json(value, json.loads(Path(plot['golden']).read_text())['api_observations'][key]):
        raise ValueError('busy/cancel/public-identity observation mismatch')
    state.setdefault('api_observations', {})[key] = value
