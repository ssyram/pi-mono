import json
import os
from plot_contract import assert_expectations, expand, normalize
from run_processes import http
from json_equality import exact_json


def hc_tool_result(run, actor, index, step, plot, bindings):
    session = bindings['session.' + actor]
    messages = http(int(os.environ['PLOT_HC_PORT']), f'/session/{session}/message')
    call_id = f'plot_{actor}_{index:03d}'
    parts = [part for message in messages for part in message['parts'] if part['type'] == 'tool' and part['callID'] == call_id]
    if len(parts) != 1:
        raise ValueError(f'expected one durable HC tool part for {call_id}')
    part = parts[0]
    info = next(message['info'] for message in messages if message['info']['id'] == part['messageID'])
    if step.get('hc_agent') is not None and info['agent'] != step['hc_agent']:
        raise ValueError('actual assistant agent profile differs from declared phase')
    if info['providerID'] != 'plot' or info['modelID'] != 'plot-model':
        raise ValueError('unexpected non-mock model')
    (run / 'hc-tool-parts' / f'{call_id}.json').write_text(json.dumps(part, ensure_ascii=False, indent=2))
    assert_expectations(part, [{'path': '/sessionID', 'equals': session}, {'path': '/tool', 'equals': step['tool']},
                               {'path': '/state/status', 'equals': step.get('hc_status', 'completed')},
                               {'path': '/id', 'regex': r'^(prt_[A-Za-z0-9]+)$', 'bind': f'part.{actor}.{index}'},
                               {'path': '/messageID', 'regex': r'^(msg_[A-Za-z0-9]+)$', 'bind': f'message.{actor}.{index}'}], bindings)
    assert_expectations(part, step.get('part_expect', []), bindings)
    if not exact_json(part['state']['input'], expand(step['arguments'], bindings)):
        raise ValueError('durable HC tool input does not match plot')
    timing = part['state']['time']
    if not (isinstance(timing['start'], int) and isinstance(timing['end'], int) and timing['start'] <= timing['end']):
        raise ValueError('invalid HC tool time interval')
    timing['start'] = '<timestamp:start<=end>'
    timing['end'] = '<timestamp:start<=end>'
    dynamic = [name for name in bindings if name.startswith(('part.', 'message.'))]
    return {'part': normalize(part, bindings, [], [*plot['normalize_bindings'], *dynamic]), 'agent': info['agent'], 'model': {'providerID': info['providerID'], 'modelID': info['modelID']}}
