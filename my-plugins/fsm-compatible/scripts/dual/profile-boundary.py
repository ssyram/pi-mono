import copy
import json
import os
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


def tool_result(run, actor, index, step, plot, bindings):
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
plot_engine.exact_json = compare_receipt
sys.argv = [str(engine / 'bin/use-plot'), *sys.argv[2:]]
runpy.run_path(str(engine / 'bin/use-plot'), run_name='__main__')
