import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from plot_contract import assert_expectations
from plot_engine import execute, save
from completion_observation import quiescent_status
from json_equality import exact_json

ROOT = Path(__file__).resolve().parents[1]


class JsonTypeTests(unittest.TestCase):
    def test_bool_and_integer_are_not_equal(self):
        with self.assertRaises(ValueError):
            assert_expectations({'ok': 1}, [{'path': '/ok', 'equals': True}], {})

    def test_integer_and_float_are_not_equal(self):
        with self.assertRaises(ValueError):
            assert_expectations({'value': 1.0}, [{'path': '/value', 'equals': 1}], {})

    def test_nested_boolean_and_number_are_not_equal(self):
        with self.assertRaises(ValueError):
            assert_expectations({'items': [{'passed': 1}]}, [{'equals': {'items': [{'passed': True}]}}], {})

    def test_object_key_order_is_not_semantic(self):
        assert_expectations({'b': 2, 'a': True}, [{'equals': {'a': True, 'b': 2}}], {})

    def test_quiescent_status_is_not_an_empty_list(self):
        self.assertTrue(quiescent_status({}))
        with self.assertRaises(ValueError):
            quiescent_status([])

    def test_business_actions_and_workflows_are_unchanged_from_v1(self):
        for name in ('reference', 'idle-resume', 'soft-review'):
            old = json.loads((ROOT / f'evidence/v1-runtime/plots/{name}.json').read_text())
            current = json.loads((ROOT / f'plots/{name}.json').read_text())
            self.assertTrue(exact_json(old['actors'], current['actors']))
            self.assertTrue(exact_json(old['workflows'], current['workflows']))
        for path in (ROOT / 'workflows').glob('*.yaml'):
            self.assertEqual(path.read_bytes(), (ROOT / 'evidence/v1-runtime/workflows' / path.name).read_bytes())

    @patch.dict(os.environ, {'PLOT_BINDINGS': '{}'})
    def test_replay_rejects_same_numeric_value_with_other_json_type(self):
        run = ROOT / '.runtime/test-evidence' / ('json-type-' + uuid4().hex[:8])
        run.mkdir(parents=True)
        golden = run / 'golden.json'
        save(golden, {'receipts': {'root/000': {'toolCallId': 'plot_root_000', 'json': {'value': 1.0}}}})
        plot = {'golden': str(golden), 'actors': {'root': {'marker': 'TYPE_ROOT', 'result': 'must not finish', 'steps': [
            {'tool': 'calculate', 'arguments': {}, 'capture': ['toolCallId', 'json'], 'expect': [{'path': '/json/value', 'equals': 1}]}]}}}
        path = run / 'plot.json'
        save(path, plot)
        initial = {'request': {'context': {'messages': [{'role': 'user', 'content': 'TYPE_ROOT'}]}}}
        execute(path, run, 'replay', initial)
        response = {'request': {'context': {'messages': [*initial['request']['context']['messages'],
            {'role': 'toolResult', 'toolCallId': 'plot_root_000', 'content': [{'text': json.dumps({'value': 1})}]}]}}}
        with self.assertRaisesRegex(ValueError, 'golden mismatch'):
            execute(path, run, 'replay', response)
        self.assertFalse(json.loads((run / 'state.json').read_text())['actors']['root']['done'])


if __name__ == '__main__':
    unittest.main()
