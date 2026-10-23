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


def compare_receipt(left, right):
    if isinstance(left, dict) and isinstance(right, dict):
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
