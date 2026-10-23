import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from event_tool_settlement import settle_events
from golden_baseline import freeze, verify_inputs
from plot_engine import execute, receive, save
from plot_validation import validate_plot
from transition_ledger_observation import transition_ledger

ROOT = Path(__file__).resolve().parents[1]


class TerminalAndBaselineTests(unittest.TestCase):
    def directory(self):
        run = ROOT / '.runtime/test-evidence' / ('terminal-' + uuid4().hex[:8])
        (run / 'hc-tool-parts').mkdir(parents=True)
        return run

    def test_freeze_is_atomic_exclusive_and_read_only(self):
        run = self.directory()
        path = run / 'golden.json'
        freeze(path, {'value': 1}, 'first')
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertRaises(FileExistsError):
            freeze(path, {'value': 2}, 'second')
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertEqual(path.stat().st_mode & 0o222, 0)

    def test_replay_checks_all_bound_inputs(self):
        golden = {'plotHash': 'a', 'behaviorHashes': {'source': 'b'}, 'binaries': {'hc': 'c'}}
        verify_inputs(golden, golden)
        for key in golden:
            changed = {**golden, key: 'different'}
            with self.assertRaisesRegex(ValueError, 'replay input changed'):
                verify_inputs(golden, changed)

    def test_undeclared_plot_field_is_not_silently_ignored(self):
        plot = {'golden': 'unused', 'actors': {'root': {'marker': 'ROOT', 'result': 'x', 'steps': [
            {'tool': 'x', 'arguments': {}, 'capture': ['toolCallId'], 'expect': [{'equals': 1}], 'replay': 'different'}]}}}
        with self.assertRaisesRegex(ValueError, 'unknown plot step fields'):
            validate_plot(plot)

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_declared_pause_preserves_actor_progress(self):
        run = self.directory()
        plot = {'golden': str(run / 'unused.json'), 'actors': {'root': {'marker': 'PAUSE_ROOT', 'result': 'done', 'steps': [
            {'kind': 'pause', 'text': 'waiting'},
            {'tool': 'calculate', 'arguments': {}, 'capture': ['toolCallId', 'text'], 'expect': [{'path': '/text', 'equals': '42'}],
             'inbox': [{'contains': 'RESUME', 'expect': [{'path': '/message', 'contains': 'RESUME'}]}]}]}}}
        path = run / 'plot.json'
        save(path, plot)
        request = {'request': {'context': {'messages': [{'role': 'user', 'content': 'PAUSE_ROOT'}]}}}
        self.assertEqual(execute(path, run, 'collect', request)['content'][0]['text'], 'waiting')
        state = json.loads((run / 'state.json').read_text())
        self.assertFalse(state['actors']['root']['done'])
        request['request']['context']['messages'].append({'role': 'user', 'content': 'RESUME'})
        self.assertEqual(execute(path, run, 'collect', request)['content'][0]['id'], 'plot_root_001')

    def test_structured_tool_is_settled_from_real_event_shape(self):
        run = self.directory()
        step = {'tool': 'StructuredOutput', 'arguments': {'summary': 'verified'}, 'settle_via_event': True,
                'capture': ['toolCallId', 'input', 'text'], 'expect': [{'path': '/input/summary', 'equals': 'verified'}, {'path': '/text', 'equals': 'captured'}]}
        plot = {'actors': {'review': {'steps': [step], 'result': 'verified'}}, 'normalize_bindings': ['session.review']}
        state = {'bindings': {}, 'actors': {'review': {'pending': 0}}, 'receipts': {}}
        part = {'id': 'prt_abc', 'sessionID': 'ses_abc', 'messageID': 'msg_abc', 'callID': 'plot_review_000', 'type': 'tool', 'tool': 'StructuredOutput',
                'state': {'status': 'completed', 'input': {'summary': 'verified'}, 'output': 'captured', 'time': {'start': 1, 'end': 2}}}
        (run / 'hc-tools.jsonl').write_text(json.dumps({'kind': 'event', 'input': {'type': 'message.part.updated', 'properties': {'part': part}}}) + '\n')
        self.assertTrue(settle_events(plot, run, 'collect', state, receive))
        self.assertTrue(state['actors']['review']['done'])
        self.assertEqual(state['receipts']['review/000']['event_part']['sessionID'], '${session.review}')

    def test_transition_ledger_rejects_new_events_and_bad_duration(self):
        row = {'emit': ['transition', 'finish'], 'content': {'result': 'pass', 'duration_ms': 2}}
        step = {'ledger': [{'emit': 'transition.finish', 'expect': [{'path': '/content/result', 'equals': 'pass'}], 'duration_bound_ms': 10}]}
        self.assertEqual(transition_ledger([row], step, {})[0]['content']['duration_ms'], '<duration-ms:0..10>')
        with self.assertRaises(ValueError):
            transition_ledger([], step, {})
        row['content']['duration_ms'] = 11
        with self.assertRaises(ValueError):
            transition_ledger([row], step, {})


if __name__ == '__main__':
    unittest.main()
