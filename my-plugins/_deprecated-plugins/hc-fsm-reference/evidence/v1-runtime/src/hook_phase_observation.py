import json
from pathlib import Path
from plot_contract import expand, normalize


def background_hooks(run, plot, state):
    bindings, actors = state['bindings'], state['actors']
    spec = plot['observations']
    starts, intermediate = {}, {}
    normal_count = 0
    total = 0
    for path in (run / 'hooks').glob('*.input.json'):
        total += 1
        prefix = Path(str(path).removesuffix('.input.json'))
        argv = prefix.with_suffix('.argv').read_text().splitlines()
        if not prefix.with_suffix('.exit').exists():
            raise ValueError('hook still in flight at completion')
        if argv[0] in ('identity-acquire', 'check-permission'):
            continue
        if argv != [argv[0], '--emit', 'json', '--agent-cli', 'opencode']:
            raise ValueError('background hook argv mismatch')
        payload = json.loads(path.read_text())
        actor_names = [actor for actor in spec['fsm_actors'] if payload['agent_id'] == ('main' if actor == 'root' else bindings['session.' + actor])]
        if len(actor_names) != 1:
            raise ValueError('unknown background hook actor')
        actor = actor_names[0]
        record = {'argv': argv, 'input': payload, 'exit': int(prefix.with_suffix('.exit').read_text()),
                  'stdout': prefix.with_suffix('.stdout').read_text(), 'stderr': prefix.with_suffix('.stderr').read_text()}
        if record['exit'] != 0 or record['stderr']:
            raise ValueError(f'background hook failure: {actor}/{argv[0]}')
        if argv[0] == 'subagent-start':
            if record['stdout'] != '':
                raise ValueError('child startup must be silent on stdout')
            expected = {'session_id': bindings['session.root'], 'agent_id': bindings['session.' + actor], 'cwd': bindings['work']}
            if payload != expected or actor in starts:
                raise ValueError('child startup identity/cardinality mismatch')
            starts[actor] = record
        elif argv[0] in ('stop', 'subagent-stop'):
            if json.loads(record['stdout'])['decision'] != 'allow':
                raise ValueError('background Stop did not allow')
            if payload['last_assistant_message'] == actors[actor]['result']:
                normal_count += 1
                continue
            candidates = [phase for phase in spec.get('intermediate_stops', []) if phase['actor'] == actor and expand(phase['message'], bindings) == payload['last_assistant_message']]
            if len(candidates) != 1 or candidates[0]['name'] in intermediate:
                raise ValueError('undeclared or duplicate intermediate Stop')
            intermediate[candidates[0]['name']] = record
        else:
            raise ValueError(f'undeclared hook phase: {argv[0]}')
    children = set(spec['fsm_actors']) - {'root'}
    if set(starts) != children or normal_count != len(spec['fsm_actors']) or len(intermediate) != len(spec.get('intermediate_stops', [])):
        raise ValueError('background hook completeness mismatch')
    tool_count = sum(sum(step.get('kind') != 'pause' for step in plot['actors'][actor]['steps']) for actor in spec['fsm_actors'])
    if total != tool_count + len(starts) + normal_count + len(intermediate):
        raise ValueError('unmatched hook invocation exists')
    return normalize({'child_starts': starts, 'intermediate_stops': intermediate, 'total': total}, bindings, [], plot['normalize_bindings'])
