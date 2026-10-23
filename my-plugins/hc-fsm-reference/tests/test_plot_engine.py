import hashlib
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from plot_engine import execute, load, save

ROOT = Path(__file__).resolve().parents[1]


def fixture():
    run = ROOT / '.runtime/test-evidence' / ('engine-' + uuid4().hex[:8])
    run.mkdir(parents=True)
    golden = run / 'golden.json'
    plot = {'golden': str(golden), 'actors': {'root': {'marker': 'UNIT_ROOT', 'result': 'verified', 'steps': [
        {'tool': 'calculate', 'arguments': {'x': 1}, 'capture': ['toolCallId', 'json'], 'expect': [{'path': '/json/value', 'equals': 2}]}]}}}
    path = run / 'plot.json'
    save(path, plot)
    request = {'request': {'context': {'messages': [{'role': 'user', 'content': 'UNIT_ROOT'}]}}}
    return run, path, golden, request


def result(request, number):
    return {'request': {'context': {'messages': [*request['request']['context']['messages'],
        {'role': 'toolResult', 'toolCallId': 'plot_root_000', 'content': [{'text': json.dumps({'value': number})}]}]}}}


class EngineTests(unittest.TestCase):
    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_collect_checks_then_completes_without_freezing(self):
        run, path, golden, request = fixture()
        response = execute(path, run, 'collect', request)
        self.assertEqual(response['content'][0]['name'], 'calculate')
        response = execute(path, run, 'collect', result(request, 2))
        self.assertEqual(response['content'][0]['text'], 'verified')
        self.assertTrue(load(run / 'state.json', {})['actors']['root']['done'])
        self.assertFalse(golden.exists())

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_collect_failure_latches_before_advancement(self):
        run, path, golden, request = fixture()
        execute(path, run, 'collect', request)
        with self.assertRaises(ValueError):
            execute(path, run, 'collect', result(request, 99))
        first = (run / 'FAILURE.json').read_bytes()
        with self.assertRaisesRegex(ValueError, 'first failure latched'):
            execute(path, run, 'collect', result(request, 2))
        self.assertEqual((run / 'FAILURE.json').read_bytes(), first)
        self.assertEqual(load(run / 'state.json', {})['actors']['root']['next'], 0)
        self.assertFalse(golden.exists())

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_golden_mismatch_is_not_rerecorded(self):
        run, path, golden, request = fixture()
        save(golden, {'receipts': {'root/000': {'toolCallId': 'plot_root_000', 'json': {'value': 999}}}})
        before = hashlib.sha256(golden.read_bytes()).hexdigest()
        execute(path, run, 'replay', request)
        with self.assertRaisesRegex(ValueError, 'golden mismatch'):
            execute(path, run, 'replay', result(request, 2))
        self.assertEqual(hashlib.sha256(golden.read_bytes()).hexdigest(), before)
        self.assertTrue((run / 'mismatch-root-0.json').exists())
        self.assertEqual(load(run / 'state.json', {})['actors']['root']['pending'], 0)

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_duplicate_receipt_fails(self):
        run, path, golden, request = fixture()
        execute(path, run, 'collect', request)
        duplicate = result(request, 2)
        duplicate['request']['context']['messages'].append(duplicate['request']['context']['messages'][-1])
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            execute(path, run, 'collect', duplicate)


if __name__ == '__main__':
    unittest.main()
