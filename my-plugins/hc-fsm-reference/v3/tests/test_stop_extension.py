import json
import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from actor_identity import actor_identity
from stop_prompt import BEGIN, END, FACTS, route_actor, stop_prompt
from stop_phase_observation import phase_hook, stop_phase_ready
from plot_engine import execute
from process_identity_observation import process_identity


def directory():
    path = ROOT / 'evidence/unit' / uuid4().hex[:8]
    path.mkdir(parents=True)
    return path


class StopExtensionTests(unittest.TestCase):
    def request(self, current='C'):
        return [{'role': 'system', 'content': 'Native Stop contract\n' + FACTS + json.dumps({'legal_pause': False, 'state_id': 'Work'})},
            {'role': 'user', 'content': BEGIN + json.dumps({'last_assistant_message': current, 'recent_stop_plans': ['A', 'B', 'C']}) + END}]

    def test_router_uses_current_lam_not_old_ring_marker(self):
        plot = {'actors': {name: {'marker': name, 'stop_for': name} for name in ('A', 'B', 'C')}}
        self.assertEqual(route_actor(self.request(), plot), 'C')

    def test_undeclared_stop_request_cannot_fall_back_to_root(self):
        with self.assertRaises(ValueError):
            route_actor(self.request(), {'actors': {'root': {'marker': 'C'}}})

    def test_native_evidence_keys_are_exact(self):
        messages = self.request()
        messages[1]['content'] = BEGIN + '{"last_assistant_message":"C"}' + END
        with self.assertRaises(ValueError):
            stop_prompt(messages)

    def test_two_roots_with_main_are_distinct_tuples(self):
        plot = {'actors': {'root': {}, 'alien': {'root': 'alien'}}}
        bindings = {'session.root': 'ses_r', 'session.alien': 'ses_a'}
        self.assertEqual(actor_identity('root', plot, bindings), ('ses_r', 'main'))
        self.assertEqual(actor_identity('alien', plot, bindings), ('ses_a', 'main'))

    def test_hook_verdict_count_is_not_boolean(self):
        run = directory()
        (run / 'hooks').mkdir()
        prefix = run / 'hooks/123'
        payload = {'session_id': 'ses_r', 'agent_id': 'ses_s', 'last_assistant_message': 'A', 'cwd': '/work'}
        (prefix.with_suffix('.input.json')).write_text(json.dumps(payload))
        prefix.with_suffix('.argv').write_text('subagent-stop\n--emit\njson\n--agent-cli\nopencode\n')
        prefix.with_suffix('.exit').write_text('2\n')
        prefix.with_suffix('.stderr').write_text('Continue A\n')
        output = prefix.with_suffix('.stdout')
        output.write_text(json.dumps({'decision': 'block', 'reason': 'Continue A', 'no_progress_count': True}))
        phase = {'name': 'A', 'actor': 'subject', 'message': 'A', 'reason': 'Continue A', 'decision': 'block', 'count': 1}
        plot = {'actors': {'subject': {}}}
        bindings = {'session.root': 'ses_r', 'session.subject': 'ses_s', 'work': '/work'}
        with self.assertRaises(ValueError):
            phase_hook(run, phase, plot, bindings)
        previous = output.read_text()
        self.assertIn('true', previous)
        output.write_text(json.dumps({'decision': 'block', 'reason': 'Continue A', 'no_progress_count': 1}))
        self.assertEqual(phase_hook(run, phase, plot, bindings)['exit'], 2)

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_bad_stop_facts_latch_before_retry_or_freeze(self):
        run = directory()
        actor = {'marker': 'J', 'stop_for': 'C', 'request_expect': [{'path': '/facts/state_id', 'equals': 'Done'}],
            'request_capture': ['facts', 'evidence', 'model'], 'result': 'r', 'steps': [{'tool': 'StructuredOutput', 'arguments': {},
                'capture': ['toolCallId'], 'expect': [{'path': '/toolCallId', 'equals': 'unused'}], 'settle_via_event': True}]}
        plot = {'golden': str(run / 'never.json'), 'actors': {'root': {'marker': 'ROOT', 'result': 'r', 'steps': [{'kind': 'pause', 'text': 'x'}]}, 'judge': actor}}
        path = run / 'plot.json'
        path.write_text(json.dumps(plot))
        request = {'request': {'model': 'plot-model', 'context': {'messages': self.request()}}}
        with self.assertRaises(ValueError):
            execute(path, run, 'collect', request)
        first = (run / 'FAILURE.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'first failure latched'):
            execute(path, run, 'collect', request)
        self.assertEqual(first, (run / 'FAILURE.json').read_bytes())
        self.assertFalse((run / 'never.json').exists())

    def test_wait_phase_does_not_invent_a_completed_judge(self):
        run = directory()
        plot = {'observations': {'stop_phases': [{'name': 'wait', 'judge': 'j', 'actor': 'root'}]}}
        self.assertFalse(stop_phase_ready(run, 'wait', plot, {'actors': {}, 'bindings': {}}))

    def test_multi_root_registry_requires_every_root_and_same_owned_process(self):
        run = directory()
        (run / 'hc.process.json').write_text('{"pid":1234}')
        records = [{'agent_pid': 1234, 'start_time': 999, 'session_id': sid, 'cwd': '/work', 'opencode_server_url': 'http://127.0.0.1:5'} for sid in ('ses_a', 'ses_r')]
        path = run / 'fsm-identities.json'
        path.write_text(json.dumps(records))
        plot = {'roots': ['root', 'alien'], 'normalize_bindings': ['session.root', 'session.alien', 'work'], 'observations': {'process_identity': {'count': 2}}}
        bindings = {'session.root': 'ses_r', 'session.alien': 'ses_a', 'work': '/work'}
        self.assertEqual(set(process_identity(run, 5, plot, bindings)), {'root', 'alien'})
        previous = json.loads(path.read_text())
        previous[1]['agent_pid'] = 9876
        path.write_text(json.dumps(previous))
        with self.assertRaises(ValueError):
            process_identity(run, 5, plot, bindings)


if __name__ == '__main__':
    unittest.main()
