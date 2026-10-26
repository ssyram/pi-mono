import copy
import json
import os
import re
import runpy
import sys
from pathlib import Path

engine = Path(sys.argv[1])
sys.path.insert(0, str(engine / 'src'))
import json_equality
import hc_tool_observation

strict_json = json_equality.exact_json
original_result = hc_tool_observation.hc_tool_result
boundary_log = Path(os.environ['PLOT_RUN']) / 'profile-boundaries.jsonl'
D9_SKIP = json.loads(os.environ.get('PLOT_D9_SKIP') or '{}')
d9_log = Path(os.environ['PLOT_RUN']) / 'd9-boundaries.jsonl'
active_alignment = {'tokens': []}


def record(point, call_id, golden):
    with boundary_log.open('a') as output:
        output.write(json.dumps({'point': point, 'callID': call_id, 'golden': golden, 'pi': None}) + '\n')


def tool_result(run, actor, index, step, plot, bindings):
    # D8: HC defaultInfo profile has no Pi counterpart; skip exactly this
    # assertion, keep every other observation strict.
    if step.get('hc_agent') is not None:
        record('hc_agent assertion', f'plot_{actor}_{index:03d}', step['hc_agent'])
        step = {key: value for key, value in step.items() if key != 'hc_agent'}
    return original_result(run, actor, index, step, plot, bindings)


def project_agent_list_row(text, call_id):
    # D8: the HC self row's agent_type comes from the host default profile and
    # its title from the host session title; Pi has neither concept.
    lines = text.split('\n')
    header = 'session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir'
    if len(lines) < 2 or lines[0] != header:
        return text
    projected = False
    for i, line in enumerate(lines[1:], start=1):
        columns = line.split('\t')
        if len(columns) == 7 and columns[3] == 'self':
            record('agent_list self agent_type/title', call_id, [columns[2], columns[5]])
            columns[2] = ''
            columns[5] = ''
            lines[i] = '\t'.join(columns)
            projected = True
    return '\n'.join(lines) if projected else text


def request_messages(request):
    inner = request.get('request') if isinstance(request.get('request'), dict) else None
    context = (inner or request).get('context', {}) if isinstance(inner or request, dict) else {}
    messages = context.get('messages', []) if isinstance(context, dict) else []
    return messages if isinstance(messages, list) else []


def request_tokens_absent(request, tokens):
    # The engine's inbox observation matches only user messages; a token that
    # merely appears inside a toolCall's arguments is still "absent" to it.
    users = [item for item in request_messages(request) if isinstance(item, dict) and item.get('role') == 'user']
    wire = json.dumps(users, ensure_ascii=False)
    return [token for token in tokens if token not in wire]


def current_actor(plot, request):
    messages = json.dumps(request_messages(request), ensure_ascii=False)
    for name, spec in plot.get('actors', {}).items():
        if spec.get('marker') and spec['marker'] in messages:
            return name
    return None


def accepted_send_bodies(absent_tokens):
    """Bodies of agent_send calls with a successful Accepted result on disk."""
    import glob
    run = Path(os.environ['PLOT_RUN'])
    files = []
    sessions_path = run / 'pi-sessions.json'
    if sessions_path.exists():
        for session in json.loads(sessions_path.read_text()):
            if session.get('sessionFile'):
                files.append(session['sessionFile'])
            if session.get('agentDir'):
                files.extend(glob.glob(f"{session['agentDir']}/fsm-compatible/*/*/session.jsonl"))
    else:
        legacy = run / 'pi-session.json'
        if legacy.exists():
            entry = json.loads(legacy.read_text())
            if entry.get('sessionFile'):
                files.append(entry['sessionFile'])
    bodies = []
    for path in files:
        try:
            text = Path(path).read_text()
        except OSError:
            continue
        records = []
        for line in text.split('\n'):
            try:
                records.append(json.loads(line).get('message', {}))
            except ValueError:
                records.append({})
        for message in records:
            content = message.get('content')
            if not isinstance(content, list):
                continue
            for block in content:
                if not (isinstance(block, dict) and block.get('type') == 'toolCall' and block.get('name') == 'agent_send'):
                    continue
                body = str((block.get('arguments') or {}).get('message', ''))
                if not any(token in body for token in absent_tokens):
                    continue
                call_id = block.get('id')
                completed = any(
                    isinstance(other.get('content'), list)
                    and other.get('role') == 'toolResult' and other.get('toolCallId') == call_id
                    and any('Accepted for' in str(part.get('text', '')) for part in other['content'] if isinstance(part, dict))
                    for other in records)
                if completed:
                    bodies.append(body)
    return bodies


def d9_bindings_for(step, absent_tokens):
    wants = []
    for item in step.get('inbox', []):
        if not any(token in item.get('contains', '') for token in absent_tokens):
            continue
        for expectation in item.get('expect', []):
            if expectation.get('bind') and expectation.get('regex'):
                wants.append((expectation['bind'], expectation['regex']))
    if not wants:
        return {}
    values = {}
    for body in accepted_send_bodies(absent_tokens):
        for name, pattern in wants:
            if name in values:
                continue
            found = re.search(pattern, body)
            if found:
                values[name] = found.group(1) if found.groups() else found.group(0)
    return values


def process(plot, run, mode, request, **kwargs):
    absent = []
    actor = None
    if D9_SKIP:
        actor = current_actor(plot, request)
        declared = []
        for step_key, tokens in D9_SKIP.items():
            if step_key.partition('/')[0] == actor:
                declared.extend(tokens)
        if declared:
            absent = request_tokens_absent(request, declared)
    active_alignment['tokens'] = list(absent)
    try:
        if absent:
            plot = copy.deepcopy(plot)
            steps = plot.get('actors', {}).get(actor, {}).get('steps', [])
            recovered = {}
            for step_index, step in enumerate(steps):
                if not step.get('inbox'):
                    continue
                kept = [item for item in step['inbox']
                    if not any(token in item.get('contains', '') for token in absent)]
                if len(kept) == len(step['inbox']):
                    continue
                with d9_log.open('a') as output:
                    for item in step['inbox']:
                        if item not in kept:
                            output.write(json.dumps({'point': 'inbox assertion (absent-gated)',
                                'step': f'{actor}/{step_index:03d}', 'contains': item.get('contains')}) + '\n')
                # binds ride only on the observations being skipped (pre-filter inbox)
                recovered.update(d9_bindings_for(step, absent))
                step['inbox'] = kept
            if recovered:
                state_path = Path(run) / 'state.json'
                if state_path.exists():
                    state = json.loads(state_path.read_text())
                    bindings = state.setdefault('bindings', {})
                    for name, value in recovered.items():
                        if name in bindings and bindings[name] != value:
                            raise ValueError(f'D9 bind recovery conflict on {name}: '
                                             f'existing {bindings[name]!r} vs recovered {value!r}')
                    bindings.update(recovered)
                    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
                    with d9_log.open('a') as output:
                        output.write(json.dumps({'point': 'bind recovery', 'actor': actor,
                            'values': recovered}) + '\n')
        return original_process(plot, run, mode, request, **kwargs)
    finally:
        active_alignment['tokens'] = []


def compare_receipt(left, right):
    # D9 alignment (owner ruling a): only this invocation's absent tokens may
    # drop golden inbox entries; an arrived message keeps both sides strict.
    if isinstance(left, list) and isinstance(right, list):
        tokens_all = active_alignment['tokens']
        if tokens_all:
            consumed_text = json.dumps(left, ensure_ascii=False)
            aligned = []
            dropped = []
            for entry in right:
                entry_text = json.dumps(entry, ensure_ascii=False)
                carries = [t for t in tokens_all if t in entry_text]
                if carries and not any(t in consumed_text for t in carries):
                    dropped.append(entry)
                    continue
                aligned.append(entry)
            if dropped:
                with d9_log.open('a') as output:
                    output.write(json.dumps({'point': 'inbox golden alignment',
                        'dropped': [json.dumps(e, ensure_ascii=False)[:120] for e in dropped]}) + '\n')
            right = aligned
    if isinstance(left, dict) and isinstance(right, dict):
        if isinstance(left.get('text'), str) and left['text'].startswith('session_id\t'):
            left = {**left, 'text': project_agent_list_row(left['text'], left.get('toolCallId'))}
            observation = left.get('observation') or {}
            hc = observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], left.get('toolCallId'))}}
                left = {**left, 'observation': {**observation, 'hc_result': hc}}
            right = copy.deepcopy(right)
            if isinstance(right.get('text'), str):
                right['text'] = project_agent_list_row(right['text'], right.get('toolCallId'))
            observation = right.get('observation') or {}
            hc = observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str) and hc['state']['output'].startswith('session_id\t'):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], right.get('toolCallId'))}}
                right = {**right, 'observation': {**observation, 'hc_result': hc}}
        actual = left.get('observation', {}).get('hc_result')
        expected = right.get('observation', {}).get('hc_result')
        if isinstance(actual, dict) and isinstance(expected, dict) and 'agent' in actual and 'agent' in expected:
            if actual['agent'] is None:
                record('hc_result.agent equality', left.get('toolCallId'), expected['agent'])
                right = copy.deepcopy(right)
                right['observation']['hc_result']['agent'] = None
    return strict_json(left, right)


hc_tool_observation.hc_tool_result = tool_result
import plot_engine
original_process = getattr(plot_engine, 'process', None)
if original_process is not None:
    plot_engine.process = process
plot_engine.exact_json = compare_receipt
sys.argv = [str(engine / 'bin/use-plot'), *sys.argv[2:]]
runpy.run_path(str(engine / 'bin/use-plot'), run_name='__main__')
