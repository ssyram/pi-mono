import json
from pathlib import Path
from plot_contract import assert_expectations, expand, normalize


def settle_events(plot, run, mode, state, receive):
    if not (run / 'hc-tools.jsonl').exists():
        return False
    pending = []
    for actor, progress in state.get('actors', {}).items():
        index = progress['pending']
        if index is not None and plot['actors'][actor]['steps'][index].get('settle_via_event'):
            pending.append((actor, progress, index))
    if not pending:
        return False
    events = [json.loads(line) for line in (run / 'hc-tools.jsonl').read_text().splitlines()]
    changed = False
    for actor, progress, index in pending:
        call_id = f'plot_{actor}_{index:03d}'
        parts = [event['input']['properties']['part'] for event in events if event['kind'] == 'event' and event['input']['type'] == 'message.part.updated'
                 and event['input']['properties']['part'].get('callID') == call_id
                 and event['input']['properties']['part'].get('state', {}).get('status') in ('completed', 'error')]
        if not parts:
            continue
        if len(parts) != 1:
            raise ValueError('duplicate terminal tool settlement event')
        part = parts[0]
        step = plot['actors'][actor]['steps'][index]
        bindings = state['bindings']
        assert_expectations(part, [{'path': '/type', 'equals': 'tool'}, {'path': '/tool', 'equals': step['tool']}, {'path': '/state/status', 'equals': 'completed'},
            {'path': '/sessionID', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.' + actor},
            {'path': '/id', 'regex': '^(prt_[A-Za-z0-9]+)$', 'bind': f'part.{actor}.{index}'},
            {'path': '/messageID', 'regex': '^(msg_[A-Za-z0-9]+)$', 'bind': f'message.{actor}.{index}'}], bindings)
        if part['state']['input'] != expand(step['arguments'], bindings):
            raise ValueError('terminal tool input differs from plot')
        result = {'toolCallId': call_id, 'toolName': part['tool'], 'isError': False, 'input': part['state']['input'],
                  'content': [{'text': part['state']['output']}]}
        receipt = receive(step, result, bindings, plot.get('normalize_bindings', []))
        (run / 'hc-tool-parts' / f'{call_id}.json').write_text(json.dumps(part, ensure_ascii=False, indent=2))
        timing = part['state']['time']
        if not (isinstance(timing['start'], int) and isinstance(timing['end'], int) and timing['start'] <= timing['end']):
            raise ValueError('invalid terminal tool time interval')
        timing.update({'start': '<timestamp:start<=end>', 'end': '<timestamp:start<=end>'})
        dynamic = [name for name in bindings if name.startswith(('part.', 'message.'))]
        receipt['event_part'] = normalize(part, bindings, [], [*plot['normalize_bindings'], *dynamic])
        key = f'{actor}/{index:03d}'
        if mode != 'collect' and receipt != json.loads(Path(plot['golden']).read_text())['receipts'][key]:
            raise ValueError(f'terminal tool golden mismatch: {key}')
        state['receipts'][key] = receipt
        progress.update({'next': index + 1, 'pending': None})
        if index + 1 != len(plot['actors'][actor]['steps']):
            raise ValueError('event-settled tool must be the terminal actor action')
        progress.update({'done': True, 'result': expand(plot['actors'][actor]['result'], bindings)})
        changed = True
    return changed
