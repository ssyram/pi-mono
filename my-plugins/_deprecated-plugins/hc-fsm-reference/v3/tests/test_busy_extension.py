import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from api_observation import observe_api
from cancelled_run_observation import cancelled_runs
from hc_tool_observation import hc_tool_result

ABORTED = '(no output)\n\n<shell_metadata>\nUser aborted the command\n</shell_metadata>'


def directory():
    run = ROOT / 'evidence/unit' / uuid4().hex[:8]
    for name in ('api-observations', 'hc-tool-parts'):
        (run / name).mkdir(parents=True, exist_ok=True)
    (run / 'hc.process.json').write_text('{"pid":1234}')
    return run


class BusyExtensionTests(unittest.TestCase):
    @patch.dict(os.environ, {'PLOT_HC_PORT': '1'})
    def test_busy_requires_real_status_and_running_part_and_owned_pid(self):
        run = directory()
        (run / 'pid.txt').write_text('999')
        args = {'command': 'blocking'}
        part = {'type': 'tool', 'tool': 'bash', 'callID': 'plot_worker_000', 'id': 'prt_busy', 'messageID': 'msg_busy', 'sessionID': 'ses_w',
                'state': {'status': 'running', 'input': args, 'time': {'start': 100}, 'metadata': {'not_a_pid': 999}}}
        plot = {'actors': {'worker': {'steps': [{'tool': 'bash', 'arguments': args}]}}, 'normalize_bindings': ['session.worker']}
        state = {'bindings': {'session.worker': 'ses_w'}, 'actors': {}, 'receipts': {}}
        spec = {'busy': [{'actor': 'worker', 'call': 'plot_worker_000', 'pid_file': str(run / 'pid.txt')}]}
        with patch('api_observation.http', side_effect=[{'ses_w': {'type': 'busy'}}, [{'parts': [part]}]]), patch('api_observation.alive', return_value=True), patch('api_observation.descendant', return_value=True):
            observe_api(run, 'root', 0, spec, plot, state, 'collect')
        value = state['api_observations']['root/000']['busy']['worker']
        self.assertEqual(value['pid'], '${pid.worker}')
        self.assertEqual(value['part']['state']['metadata']['not_a_pid'], 999)
        bad = json.loads(json.dumps(part))
        bad['state']['status'] = 'completed'
        with patch('api_observation.http', side_effect=[{'ses_w': {'type': 'busy'}}, [{'parts': [bad]}]]):
            with self.assertRaisesRegex(ValueError, 'actually running'):
                observe_api(run, 'root', 1, spec, plot, state, 'collect')

    @patch.dict(os.environ, {'PLOT_HC_PORT': '1'})
    def test_sender_profile_is_single_declared_value_not_general_or_build(self):
        run = directory()
        part = {'type': 'tool', 'tool': 'read', 'callID': 'plot_subject_000', 'id': 'prt_p', 'messageID': 'msg_p', 'sessionID': 'ses_s',
                'state': {'status': 'completed', 'input': {}, 'time': {'start': 1, 'end': 2}}}
        messages = [{'info': {'id': 'msg_p', 'agent': 'build', 'providerID': 'plot', 'modelID': 'plot-model'}, 'parts': [part]}]
        bindings = {'session.subject': 'ses_s'}
        step = {'tool': 'read', 'arguments': {}, 'hc_agent': 'general'}
        with patch('hc_tool_observation.http', return_value=messages):
            with self.assertRaisesRegex(ValueError, 'agent profile'):
                hc_tool_result(run, 'subject', 0, step, {'normalize_bindings': ['session.subject']}, bindings)

    def test_bash_completed_abort_still_requires_exact_assistant_error(self):
        run = directory()
        error = {'name': 'MessageAbortedError', 'data': {'message': 'Aborted'}}
        part = {'id': 'prt_w', 'callID': 'plot_worker_000', 'state': {'status': 'completed', 'output': ABORTED, 'metadata': {'exit': None}}}
        message = {'info': {'id': 'msg_w', 'sessionID': 'ses_w', 'agent': 'general', 'error': error}, 'parts': [part]}
        event = {'kind': 'event', 'input': {'type': 'session.error', 'properties': {'sessionID': 'ses_w', 'error': error}}}
        (run / 'hc-tools.jsonl').write_text(json.dumps(event) + '\n')
        rule = {'actor': 'worker', 'call': 'plot_worker_000', 'error': error,
                'part_expect': [{'path': '/state/status', 'equals': 'completed'}, {'path': '/state/output', 'equals': ABORTED}, {'path': '/state/metadata/exit', 'equals': None}]}
        plot = {'normalize_bindings': ['session.worker'], 'observations': {'allowed_message_errors': [rule]}}
        state = {'bindings': {'session.worker': 'ses_w', 'message.worker.0': 'msg_w', 'part.worker.0': 'prt_w'}}
        result = cancelled_runs(run, plot, state, {'worker': [message]})
        self.assertEqual(result['events']['worker']['sessionID'], '${session.worker}')
        message['info']['error'] = {'name': 'UnknownError', 'data': {'message': 'not a cancel'}}
        with self.assertRaisesRegex(ValueError, 'undeclared actual HC'):
            cancelled_runs(run, plot, state, {'worker': [message]})


if __name__ == '__main__':
    unittest.main()
