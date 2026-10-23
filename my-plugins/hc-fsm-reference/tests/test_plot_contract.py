import json
import sys
import threading
import unittest
from pathlib import Path
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from plot_contract import assert_expectations, expand, normalize
from plot_engine import load, save

ROOT = Path(__file__).resolve().parents[1]


class ContractTests(unittest.TestCase):
    def test_injective_session_binding(self):
        bindings = {}
        assert_expectations({'id': 'ses_abc'}, [{'path': '/id', 'regex': '^(ses_abc)$', 'bind': 'session.alpha'}], bindings)
        with self.assertRaisesRegex(ValueError, 'identity collision'):
            assert_expectations({'id': 'ses_abc'}, [{'path': '/id', 'regex': '^(ses_abc)$', 'bind': 'session.beta'}], bindings)

    def test_binding_cannot_change(self):
        with self.assertRaisesRegex(ValueError, 'identity changed'):
            assert_expectations('ses_new', [{'regex': '^(ses_new)$', 'bind': 'session.root'}], {'session.root': 'ses_old'})

    def test_numeric_values_are_not_string_wildcards(self):
        value = {'callID': 'plot_root_007', 'value': '7', 'session': 'ses_777'}
        actual = normalize(value, {'number': '7', 'session.root': 'ses_777'}, [], ['session.root'])
        self.assertEqual(actual, {'callID': 'plot_root_007', 'value': '7', 'session': '${session.root}'})

    def test_exact_identity_and_timestamp_rules(self):
        rules = [{'path': '/id', 'kind': 'binding', 'name': 'session.root'}, {'path': '/time', 'kind': 'timestamp', 'regex': r'\d{4}-\d{2}-\d{2}Z'}]
        actual = normalize({'id': 'ses_x', 'time': '2026-10-23Z'}, {'session.root': 'ses_x'}, rules, [])
        self.assertEqual(actual, {'id': '${session.root}', 'time': '<timestamp>'})
        with self.assertRaises(ValueError):
            normalize({'id': 'ses_y', 'time': 'bad'}, {'session.root': 'ses_x'}, rules, [])

    def test_identity_normalization_does_not_match_prefix_collisions(self):
        value = normalize('ses_alpha ses_alphaEvil', {'session.alpha': 'ses_alpha'}, [], ['session.alpha'])
        self.assertEqual(value, '${session.alpha} ses_alphaEvil')

    def test_missing_binding_is_an_error(self):
        with self.assertRaises(KeyError):
            expand('${unknown}', {})

    def test_collect_constraint_is_not_record_anything(self):
        with self.assertRaises(ValueError):
            assert_expectations({'status': 'reject'}, [{'path': '/status', 'equals': 'accept'}], {})

    def test_atomic_single_writer_state(self):
        run = ROOT / '.runtime/test-evidence' / ('atomic-' + uuid4().hex[:8])
        run.mkdir(parents=True)
        path = run / 'state.json'
        save(path, {'n': 0})
        failures = []
        def writer():
            for number in range(100):
                save(path, {'n': number, 'payload': 'x' * 1000})
        thread = threading.Thread(target=writer)
        thread.start()
        while thread.is_alive():
            try:
                self.assertIsInstance(load(path, {})['n'], int)
            except Exception as error:
                failures.append(str(error))
        thread.join()
        self.assertEqual(failures, [])


if __name__ == '__main__':
    unittest.main()
