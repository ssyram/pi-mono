import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from plot_contract import assert_expectations, expand, normalize
from hc_tool_observation import hc_tool_result
from fsm_readonly import actor_summary
from transition_ledger_observation import transition_ledger
from json_equality import exact_json

TOOL_MAP = {'bash': ('Bash', {}), 'read': ('Read', {'filePath': 'file_path'}),
            'edit': ('Edit', {'filePath': 'file_path'}), 'write': ('Write', {'filePath': 'file_path'}),
            'glob': ('Glob', {}), 'grep': ('Grep', {}), 'agent': ('Agent', {})}


def cli(run, *arguments, expected_error=None):
    binary = Path(os.environ['PLOT_REAL_HOOK']).with_name('mcp-server-fsm')
    result = subprocess.run([str(binary), *arguments], capture_output=True, cwd=run / 'work')
    if result.returncode:
        if expected_error != result.stderr.decode() or result.returncode != 1 or result.stdout:
            raise ValueError(f'read-only CLI failed: {arguments!r}, exit={result.returncode}, stderr={result.stderr.decode()!r}')
        return None
    if expected_error is not None:
        raise ValueError('expected absent snapshot, but persistence was present')
    return result.stdout.decode()


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()


def hook_for(run, actor, call_id, tool, arguments, bindings):
    events = [json.loads(line) for line in (run / 'hc-tools.jsonl').read_text().splitlines()]
    starts = [event for event in events if event['kind'] == 'before' and event['input']['callID'] == call_id]
    if len(starts) != 1:
        raise ValueError(f'expected one HC before event: {call_id}')
    start = starts[0]
    if start['input']['sessionID'] != bindings['session.' + actor] or start['input']['tool'] != tool:
        raise ValueError('HC actor/tool identity mismatch')
    if not exact_json(start['output']['args'], expand(arguments, bindings)):
        raise ValueError('HC actual tool arguments differ from plot')
    canonical, fields = TOOL_MAP.get(tool, (tool, {}))
    subcommand = 'check-permission'
    if tool.startswith('fsm_'):
        canonical = tool[len('fsm_'):]
        subcommand = 'identity-acquire'
    expected = {'session_id': bindings['session.root'], 'agent_id': 'main' if actor == 'root' else bindings['session.' + actor],
                'tool_name': canonical, 'cwd': bindings['work']}
    if subcommand == 'check-permission':
        expected['tool_input'] = {fields.get(key, key): value for key, value in expand(arguments, bindings).items()}
    candidates = []
    for path in (run / 'hooks').glob('*.input.json'):
        if path.stat().st_mtime + 0.001 < start['observedAt'] / 1000:
            continue
        prefix = Path(str(path).removesuffix('.input.json'))
        argv = prefix.with_suffix('.argv').read_text().splitlines()
        payload = json.loads(path.read_text())
        if argv[0] == subcommand and payload.get('agent_id') == expected['agent_id'] and payload.get('tool_name') == canonical:
            candidates.append((prefix, argv, payload))
    if len(candidates) != 1:
        raise ValueError(f'expected one correlated hook for {call_id}, found {len(candidates)}')
    prefix, argv, payload = candidates[0]
    if argv != [subcommand, '--emit', 'json', '--agent-cli', 'opencode']:
        raise ValueError('correlated hook argv mismatch')
    if not exact_json(payload, expected):
        raise ValueError(f'hook canonical request mismatch for {call_id}: {payload!r} != {expected!r}')
    exit_code = int(prefix.with_suffix('.exit').read_text())
    stdout = prefix.with_suffix('.stdout').read_text()
    stderr = prefix.with_suffix('.stderr').read_text()
    if exit_code not in (0, 2):
        raise ValueError(f'hook transport error for {call_id}')
    decision = json.loads(stdout)
    if decision['decision'] != ('allow' if exit_code == 0 else 'block'):
        raise ValueError('hook exit/JSON decision mismatch')
    expected_stderr = '' if exit_code == 0 else decision['reason'] + '\n'
    if stderr != expected_stderr:
        raise ValueError(f'hook stderr does not match authoritative decision for {call_id}')
    return {'actor': actor, 'callID': call_id, 'sessionID': start['input']['sessionID'], 'tool': tool, 'arguments': start['output']['args'],
            'hook': {'argv': argv, 'input': payload, 'exit': exit_code, 'stdout': stdout, 'stderr': stderr}}, start['observedAt'] / 1000


def observe(run, actor, index, step, plot, bindings):
    spec = plot.get('observations', {})
    if actor not in spec.get('fsm_actors', []):
        return None
    call_id = f'plot_{actor}_{index:03d}'
    observation, started = hook_for(run, actor, call_id, step['tool'], step['arguments'], bindings)
    observation['hc_result'] = hc_tool_result(run, actor, index, step, plot, bindings)
    agent = 'main' if actor == 'root' else bindings['session.' + actor]
    summary = actor_summary(run, bindings['session.root'], agent, call_id)
    observation['actor_summary'] = summary
    assert_expectations(summary, step.get('actor_expect', []), bindings)
    missing = f'Error: no stack snapshot for ({bindings["session.root"]}, {agent})\n' if step.get('persisted_state') == 'absent' else None
    raw = cli(run, 'store', 'stack', bindings['session.root'], agent, expected_error=missing)
    stack = json.loads(raw) if raw is not None else None
    (run / 'fsm-states' / f'{call_id}.json').write_text(json.dumps({'snapshot': stack, 'expected_missing_error': missing}, ensure_ascii=False, indent=2))
    observation['fsm_stack'] = stack
    observation['snapshot_missing'] = missing
    assert_expectations(stack, step.get('state_expect', []), bindings)
    previous = None
    for frame in stack or []:
        for entry in frame['history']:
            timestamp = instant(entry['timestamp'])
            if previous is not None and timestamp < previous:
                raise ValueError('FSM history time moved backwards')
            previous = timestamp
            entry['timestamp'] = '<timestamp:monotonic-per-stack>'
    history = [json.loads(line) for line in cli(run, 'store', 'history', '--session', bindings['session.root'], '--agent', agent).splitlines()]
    part = json.loads((run / 'hc-tool-parts' / f'{call_id}.json').read_text())
    finished = part['state']['time']['end'] / 1000
    current = [row for row in history if started - 0.001 <= instant(row['timestamp']) <= finished + 0.001]
    for row in current:
        row['timestamp'] = '<timestamp:within-call>'
    gate_rows = [row for row in current if row['emit'][:2] == ['tool_call', 'gate']]
    if len(gate_rows) != (0 if step['tool'].startswith('fsm_') else 1):
        raise ValueError('unexpected count of daemon gate events in current tool span')
    other = [row for row in current if row['emit'][:2] != ['tool_call', 'gate']]
    observation['ledger'] = transition_ledger(other, step, bindings)
    if not step['tool'].startswith('fsm_'):
        matches = [row for row in current if row['emit'][:2] == ['tool_call', 'gate'] and row['content']['tool_name'] == observation['hook']['input']['tool_name']]
        if len(matches) != 1:
            raise ValueError(f'expected one daemon gate decision for {call_id}')
        row = matches[0]
        row['timestamp'] = '<timestamp:within-call>'
        observation['gate'] = row
        expected_decision = step.get('gate', 'allow')
        if row['content']['decision'] != expected_decision or observation['hook']['exit'] != (0 if expected_decision == 'allow' else 2):
            raise ValueError(f'unexpected gate decision for {call_id}')
        if expected_decision == 'allow':
            if 'reason_code' in row['content']:
                raise ValueError('Allow gate event must omit reason_code')
        elif row['content']['reason_code'] != step['gate_reason']:
            raise ValueError('daemon gate reason differs from declared expectation')
    return normalize(observation, bindings, [], plot['normalize_bindings'])
