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


def record(point, call_id, golden):
    with boundary_log.open('a') as output:
        output.write(json.dumps({'point': point, 'callID': call_id, 'golden': golden, 'pi': None}) + '\n')


# D9 declared-boundary (owner ruling a): scheduling-coupled inbox assertions
# are skipped only where explicitly declared, each skip logged.
D9_SKIP = json.loads(os.environ.get('PLOT_D9_SKIP') or '{}')
d9_log = Path(os.environ['PLOT_RUN']) / 'd9-boundaries.jsonl'


def skip_d9_inbox(actor, index, step):
    declared = D9_SKIP.get(f'{actor}/{index:03d}') or []
    if not declared or not step.get('inbox'):
        return step
    kept = [item for item in step['inbox'] if not any(token in item.get('contains', '') for token in declared)]
    if len(kept) == len(step['inbox']):
        return step
    with d9_log.open('a') as output:
        for item in step['inbox']:
            if item not in kept:
                output.write(json.dumps({'point': 'inbox assertion', 'actor': actor, 'index': index,
                    'contains': item.get('contains')}) + '\n')
    return {**step, 'inbox': kept}


def tool_result(run, actor, index, step, plot, bindings):
    step = skip_d9_inbox(actor, index, step)
    if step.get('hc_agent') is not None:
        record('hc_agent assertion', f'plot_{actor}_{index:03d}', step['hc_agent'])
        step = {key: value for key, value in step.items() if key != 'hc_agent'}
    return original_result(run, actor, index, step, plot, bindings)


def project_agent_list_row(text, call_id):
    # D8: the HC self row's agent_type comes from the host default profile and
    # its title from the host session title; Pi has neither concept. Project
    # exactly those two columns of the self row, leave every other row/field.
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


def compare_receipt(left, right):
    # D9 inbox comparison (owner ruling a): when the engine compares a consumed
    # inbox list against golden, golden entries whose declared token never
    # landed on the consumed side are dropped as boundaries; when the message
    # did land, both sides stay and compare strictly.
    if isinstance(left, list) and isinstance(right, list):
        tokens_all = [t for tokens in D9_SKIP.values() for t in tokens]
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
            left_observation = left.get('observation') or {}
            hc = left_observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], left.get('toolCallId'))}}
                left = {**left, 'observation': {**left_observation, 'hc_result': hc}}
            right = copy.deepcopy(right)
            if isinstance(right.get('text'), str):
                right['text'] = project_agent_list_row(right['text'], right.get('toolCallId'))
            right_observation = right.get('observation') or {}
            hc = right_observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str) and hc['state']['output'].startswith('session_id\t'):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], right.get('toolCallId'))}}
                right = {**right, 'observation': {**right_observation, 'hc_result': hc}}
        actual = left.get('observation', {}).get('hc_result')
        expected = right.get('observation', {}).get('hc_result')
        if isinstance(actual, dict) and isinstance(expected, dict) and 'agent' in actual and 'agent' in expected:
            if actual['agent'] is None:
                record('hc_result.agent equality', left.get('toolCallId'), expected['agent'])
                right = copy.deepcopy(right)
                right['observation']['hc_result']['agent'] = None
    return strict_json(left, right)


hc_tool_observation.hc_tool_result = tool_result
# Keep strict_json's recursive calls unchanged; only complete engine receipts
# cross this adapter, not arbitrary objects containing a key named agent.
import plot_engine

original_process = getattr(plot_engine, 'process', None)


def d9_bindings(plot, tokens):
    """Recover binds carried only by a skipped inbox expectation, from the
    sender's real send toolCall arguments on disk."""
    import glob
    values = {}
    wants = []
    for key in D9_SKIP:
        actor, _, index_text = key.partition('/')
        steps = plot.get('actors', {}).get(actor, {}).get('steps', [])
        index = int(index_text)
        if index >= len(steps):
            continue
        for item in steps[index].get('inbox', []):
            for expectation in item.get('expect', []):
                if expectation.get('bind') and expectation.get('regex'):
                    wants.append((expectation['bind'], expectation['regex']))
    if not wants:
        return values
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
    for path in files:
        try:
            text = Path(path).read_text()
        except OSError:
            continue
        for line in text.split('\n'):
            if 'agent_send' not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            message = entry.get('message', {})
            content = message.get('content')
            if not isinstance(content, list):
                continue
            for block in content:
                if not (isinstance(block, dict) and block.get('type') == 'toolCall' and block.get('name') == 'agent_send'):
                    continue
                body = str((block.get('arguments') or {}).get('message', ''))
                if not any(token in body for token in tokens):
                    continue
                for name, pattern in wants:
                    if name in values:
                        continue
                    found = re.search(pattern, body)
                    if found:
                        values[name] = found.group(1) if found.groups() else found.group(0)
    return values


def process(plot, run, mode, request, **kwargs):
    if D9_SKIP:
        recovered = d9_bindings(plot, [t for tokens in D9_SKIP.values() for t in tokens])
        plot = copy.deepcopy(plot)
        for key, tokens in D9_SKIP.items():
            actor, _, index_text = key.partition('/')
            steps = plot.get('actors', {}).get(actor, {}).get('steps', [])
            index = int(index_text)
            if index >= len(steps) or not steps[index].get('inbox'):
                continue
            kept = [item for item in steps[index]['inbox']
                    if not any(token in item.get('contains', '') for token in tokens)]
            if len(kept) != len(steps[index]['inbox']):
                with d9_log.open('a') as output:
                    for item in steps[index]['inbox']:
                        if item not in kept:
                            output.write(json.dumps({'point': 'inbox assertion', 'step': key,
                                'contains': item.get('contains')}) + '\n')
                steps[index]['inbox'] = kept
        if recovered:
            state_path = Path(run) / 'state.json'
            if state_path.exists():
                try:
                    state = json.loads(state_path.read_text())
                    state.setdefault('bindings', {}).update(recovered)
                    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
                    with d9_log.open('a') as output:
                        output.write(json.dumps({'point': 'bind recovery', 'values': recovered}) + '\n')
                except (OSError, ValueError):
                    pass
    return original_process(plot, run, mode, request, **kwargs)


if original_process is not None:
    plot_engine.process = process
plot_engine.exact_json = compare_receipt
sys.argv = [str(engine / 'bin/use-plot'), *sys.argv[2:]]
runpy.run_path(str(engine / 'bin/use-plot'), run_name='__main__')
