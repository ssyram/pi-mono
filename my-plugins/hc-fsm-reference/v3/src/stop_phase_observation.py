import json
from pathlib import Path
from actor_identity import actor_identity
from json_equality import exact_json
from plot_contract import expand, normalize


def phase_hook(run, phase, plot, bindings):
    session, agent = actor_identity(phase['actor'], plot, bindings)
    matches = []
    for path in (run / 'hooks').glob('*.input.json'):
        prefix = Path(str(path).removesuffix('.input.json'))
        if not prefix.with_suffix('.exit').exists():
            continue
        argv = prefix.with_suffix('.argv').read_text().splitlines()
        if argv[0] not in ('stop', 'subagent-stop'):
            continue
        payload = json.loads(path.read_text())
        if payload.get('session_id') == session and payload.get('agent_id') == agent and payload.get('last_assistant_message') == expand(phase['message'], bindings):
            matches.append((prefix, argv, payload))
    if len(matches) != 1:
        raise ValueError(f'expected exactly one real Stop hook for phase {phase["name"]}')
    prefix, argv, payload = matches[0]
    expected_input = {'session_id': session, 'agent_id': agent, 'last_assistant_message': expand(phase['message'], bindings), 'cwd': bindings['work']}
    if not exact_json(payload, expected_input):
        raise ValueError('Stop hook payload changed')
    expected_argv = ['stop' if agent == 'main' else 'subagent-stop', '--emit', 'json', '--agent-cli', 'opencode']
    if argv != expected_argv:
        raise ValueError('Stop hook argv changed')
    exit_code = int(prefix.with_suffix('.exit').read_text())
    stdout, stderr = prefix.with_suffix('.stdout').read_text(), prefix.with_suffix('.stderr').read_text()
    verdict = {'decision': phase['decision'], 'reason': phase['reason']}
    if 'count' in phase:
        verdict['no_progress_count'] = phase['count']
    if exit_code != (2 if phase['decision'] == 'block' else 0) or not exact_json(json.loads(stdout), verdict):
        raise ValueError(f'actual Stop verdict differs at {phase["name"]}')
    if stderr != phase['reason'] + '\n':
        raise ValueError('Stop evaluator diagnostics differ from declared reason')
    return {'argv': argv, 'input': payload, 'exit': exit_code, 'stdout': stdout, 'stderr': stderr}


def stop_phase_ready(run, phase_name, plot, state):
    phases = [phase for phase in plot['observations'].get('stop_phases', []) if phase['name'] == phase_name]
    if len(phases) != 1:
        raise ValueError('undeclared awaited Stop phase')
    phase = phases[0]
    if not state.get('actors', {}).get(phase['judge'], {}).get('done'):
        return False
    session, agent = actor_identity(phase['actor'], plot, state['bindings'])
    for path in (run / 'hooks').glob('*.input.json'):
        prefix = Path(str(path).removesuffix('.input.json'))
        exit_path = prefix.with_suffix('.exit')
        if not exit_path.exists() or not exit_path.read_text().strip():
            continue
        payload = json.loads(path.read_text())
        if payload.get('session_id') == session and payload.get('agent_id') == agent and payload.get('last_assistant_message') == phase['message']:
            return True
    return False


def observe_stop_phase(run, phase_name, plot, state, mode):
    phases = [phase for phase in plot['observations'].get('stop_phases', []) if phase['name'] == phase_name]
    if len(phases) != 1:
        raise ValueError('undeclared Stop phase')
    phase = phases[0]
    judge = phase['judge']
    if not state['actors'].get(judge, {}).get('done'):
        raise ValueError('Stop continuation preceded the observed structured judge completion')
    receipt = state['receipts'][judge + '/000']
    expected = {'action': phase['action'], 'reason': phase['reason']}
    if not exact_json(receipt['input'], expected):
        raise ValueError('Stop model verdict does not explain the hook verdict')
    value = {'hook': phase_hook(run, phase, plot, state['bindings']), 'judge_call': receipt['toolCallId'],
             'judge_session': state['bindings']['session.' + judge], 'subject_session': state['bindings']['session.' + phase['actor']]}
    value = normalize(value, state['bindings'], [], plot['normalize_bindings'])
    if mode != 'collect' and not exact_json(value, json.loads(Path(plot['golden']).read_text())['stop_phases'][phase_name]):
        raise ValueError('Stop hook/subject/judge linkage golden mismatch')
    state.setdefault('stop_phases', {})[phase_name] = value
    return value
