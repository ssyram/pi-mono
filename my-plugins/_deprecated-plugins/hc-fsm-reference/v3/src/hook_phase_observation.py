import json
from pathlib import Path
from actor_identity import actor_identity
from plot_contract import expand, normalize
from json_equality import exact_json
from stop_phase_observation import phase_hook


def background_hooks(run, plot, state):
    bindings, actors = state['bindings'], state['actors']
    spec = plot['observations']
    starts, intermediate, semantic = {}, {}, {}
    normal_count, total = 0, 0
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
        matches = [actor for actor in spec['fsm_actors'] if (payload['session_id'], payload['agent_id']) == actor_identity(actor, plot, bindings)]
        if len(matches) != 1:
            raise ValueError('unknown background hook actor identity tuple')
        actor = matches[0]
        record = {'argv': argv, 'input': payload, 'exit': int(prefix.with_suffix('.exit').read_text()),
                  'stdout': prefix.with_suffix('.stdout').read_text(), 'stderr': prefix.with_suffix('.stderr').read_text()}
        phases = [phase for phase in spec.get('stop_phases', []) if phase['actor'] == actor and expand(phase['message'], bindings) == payload.get('last_assistant_message')]
        if phases:
            if len(phases) != 1 or phases[0]['name'] in semantic:
                raise ValueError('duplicate semantic Stop phase')
            phase = phases[0]
            if not exact_json(record, phase_hook(run, phase, plot, bindings)) or phase['name'] not in state.get('stop_phases', {}):
                raise ValueError('unconsumed/unmatched Stop verdict phase')
            semantic[phase['name']] = record
            continue
        if record['exit'] != 0 or record['stderr']:
            raise ValueError(f'undeclared background hook failure: {actor}/{argv[0]}')
        if argv[0] == 'subagent-start':
            session, agent = actor_identity(actor, plot, bindings)
            expected = {'session_id': session, 'agent_id': agent, 'cwd': bindings['work']}
            if record['stdout'] or not exact_json(payload, expected) or actor in starts:
                raise ValueError('child startup protocol mismatch')
            starts[actor] = record
        elif argv[0] in ('stop', 'subagent-stop'):
            if json.loads(record['stdout'])['decision'] != 'allow':
                raise ValueError('undeclared background Stop decision')
            if payload.get('last_assistant_message') == actors[actor]['result']:
                normal_count += 1
                continue
            candidates = [phase for phase in spec.get('intermediate_stops', []) if phase['actor'] == actor and expand(phase['message'], bindings) == payload.get('last_assistant_message')]
            if len(candidates) != 1 or candidates[0]['name'] in intermediate:
                raise ValueError('undeclared or duplicate intermediate Stop')
            intermediate[candidates[0]['name']] = record
        else:
            raise ValueError('undeclared hook command')
    children = {actor for actor in spec['fsm_actors'] if actor != plot['actors'][actor].get('root', 'root')}
    if set(starts) != children or normal_count != len(spec['fsm_actors']) or len(intermediate) != len(spec.get('intermediate_stops', [])) or len(semantic) != len(spec.get('stop_phases', [])):
        raise ValueError('background hook completeness mismatch')
    tool_count = sum(sum(step.get('kind') != 'pause' for step in plot['actors'][actor]['steps']) for actor in spec['fsm_actors'])
    if total != tool_count + len(starts) + normal_count + len(intermediate) + len(semantic):
        raise ValueError('unmatched hook invocation exists')
    return normalize({'child_starts': starts, 'intermediate_stops': intermediate, 'semantic_stops': semantic, 'total': total}, bindings, [], plot['normalize_bindings'])
