from observation_policy import POLICY
from json_equality import exact_json

STEP_FIELDS = {'tool', 'arguments', 'capture', 'expect', 'normalize', 'wait_for', 'wait_bindings', 'wait_actors', 'inbox',
               'wait_stop_phase', 'part_expect', 'hc_agent', 'stop_phase', 'api_observe', 'gate', 'gate_reason', 'ledger', 'hc_status', 'state_expect', 'actor_expect', 'persisted_state', 'settle_via_event', 'kind', 'text'}
CAPTURE_FIELDS = {'toolCallId', 'toolName', 'content', 'isError', 'text', 'json', 'input', 'timestamp'}


def validate_plot(plot):
    if not isinstance(plot.get('actors'), dict) or 'root' not in plot['actors']:
        raise ValueError('plot requires a root actor')
    markers = [actor['marker'] for actor in plot['actors'].values()]
    if len(markers) != len(set(markers)):
        raise ValueError('actor markers must be distinct')
    for name, actor in plot['actors'].items():
        if not actor['steps'] or not isinstance(actor['result'], str):
            raise ValueError(f'actor must declare actions and final result: {name}')
        for index, step in enumerate(actor['steps']):
            unknown = set(step) - STEP_FIELDS
            if unknown:
                raise ValueError(f'unknown plot step fields: {name}/{index}: {unknown}')
            if step.get('kind') == 'pause':
                if set(step) & {'tool', 'arguments', 'capture', 'expect'} or not isinstance(step['text'], str):
                    raise ValueError('pause is a plain declared text action')
                continue
            if 'kind' in step:
                raise ValueError('unknown action kind')
            if not isinstance(step['tool'], str) or not isinstance(step['arguments'], dict):
                raise ValueError('tool action must declare name and input object')
            if not step['expect'] or 'toolCallId' not in step['capture'] or set(step['capture']) - CAPTURE_FIELDS:
                raise ValueError('tool action requires declared expectations and valid receipt projection')
            if step.get('gate', 'allow') not in ('allow', 'deny'):
                raise ValueError('gate expectation must be allow or deny')
            if step.get('hc_status', 'completed') not in ('completed', 'error'):
                raise ValueError('HC result status must be completed or error')
            for other in step.get('wait_actors', []):
                if other not in plot['actors'] or other == name:
                    raise ValueError('invalid actor readiness dependency')
            if step.get('settle_via_event') and index != len(actor['steps']) - 1:
                raise ValueError('event-settled output must terminate its actor')
    if plot.get('observations') and not exact_json(plot['observations'].get('matching'), POLICY):
        raise ValueError('plot must explicitly declare the supported strict observation policy')
    if not isinstance(plot.get('golden'), str):
        raise ValueError('plot must declare one golden path')
