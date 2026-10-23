import json
from pathlib import Path
from json_equality import exact_json
from plot_contract import assert_expectations, normalize
from stop_prompt import stop_prompt


def observe_request(actor, plot, state, request, mode):
    spec = plot['actors'][actor]
    if not spec.get('request_expect'):
        return
    view = stop_prompt(request['request']['context']['messages'])
    if view is None:
        raise ValueError('declared Stop actor did not receive a real Stop request')
    view['model'] = request['request']['model']
    assert_expectations(view, spec['request_expect'], state['bindings'])
    captured = {key: view[key] for key in spec['request_capture']}
    value = normalize(captured, state['bindings'], [], plot['normalize_bindings'])
    if mode != 'collect' and not exact_json(value, json.loads(Path(plot['golden']).read_text())['requests'][actor]):
        raise ValueError('Stop request facts/evidence/model differ from golden')
    previous = state.setdefault('requests', {}).get(actor)
    if previous is not None and not exact_json(previous, value):
        raise ValueError('same Stop actor received changed request facts')
    state['requests'][actor] = value
