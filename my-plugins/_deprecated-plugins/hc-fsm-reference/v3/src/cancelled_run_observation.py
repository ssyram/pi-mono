import json
from pathlib import Path
from json_equality import exact_json
from plot_contract import assert_expectations, normalize


def cancelled_runs(run, plot, state, all_messages):
    bindings = state['bindings']
    expected = plot['observations'].get('allowed_message_errors', [])
    found = {}
    for actor, messages in all_messages.items():
        for message in messages:
            error = message['info'].get('error')
            if error is None:
                continue
            rules = [rule for rule in expected if rule['actor'] == actor and any(part.get('callID') == rule['call'] for part in message['parts'])]
            if len(rules) != 1 or not exact_json(error, rules[0]['error']):
                raise ValueError(f'undeclared actual HC assistant error for {actor}')
            rule = rules[0]
            if rule['call'] in found:
                raise ValueError('duplicate cancelled assistant')
            part = next(part for part in message['parts'] if part.get('callID') == rule['call'])
            number = int(rule['call'].rsplit('_', 1)[1])
            assert_expectations(part, rule['part_expect'], bindings)
            if message['info']['id'] != bindings[f'message.{actor}.{number}'] or part['id'] != bindings[f'part.{actor}.{number}']:
                raise ValueError('cancellation does not correlate with observed running part')
            found[rule['call']] = {'actor': actor, 'sessionID': message['info']['sessionID'], 'messageID': message['info']['id'],
                'partID': part['id'], 'error': error, 'agent': message['info']['agent']}
    if len(found) != len(expected):
        raise ValueError('declared cancellation error was not observed')
    events = [json.loads(line) for line in (run / 'hc-tools.jsonl').read_text().splitlines()]
    error_events = [event['input']['properties'] for event in events if event['kind'] == 'event' and event['input']['type'] == 'session.error']
    bound_events = {}
    for rule in expected:
        matches = [event for event in error_events if event.get('sessionID') == bindings['session.' + rule['actor']] and exact_json(event.get('error'), rule['error'])]
        if len(matches) != 1:
            raise ValueError('expected one precisely typed cancellation session.error event')
        bound_events[rule['actor']] = matches[0]
    if len(error_events) != len(expected):
        raise ValueError('unexpected extra session.error event')
    dynamic = [name for name in bindings if name.startswith(('part.', 'message.'))]
    return normalize({'assistants': found, 'events': bound_events}, bindings, [], [*plot['normalize_bindings'], *dynamic])
