import hashlib
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]


class HcFailFastTests(unittest.TestCase):
    def test_real_hc_mismatch_latches_and_stops_owned_services(self):
        baselines = [ROOT / 'golden' / name for name in ('reference.json', 'idle-resume.json', 'soft-review.json', 'reference-v2.json', 'idle-resume-v2.json', 'soft-review-v2.json')]
        before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in baselines}
        command = [sys.executable, str(ROOT / 'src/run_experiment.py'), str(ROOT / 'plots/fail-fast.json'), '--collect', '--timeout', '60']
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=120)
        evidence = ROOT / '.runtime/test-evidence' / ('hc-mismatch-' + uuid4().hex[:8] + '.json')
        evidence.write_text(json.dumps({'command': command, 'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}, ensure_ascii=False, indent=2))
        self.assertEqual(result.returncode, 1)
        run = Path(result.stdout.strip().splitlines()[-1])
        failure = json.loads((run / 'FAILURE.json').read_text())
        self.assertIn("'equals': '43'", failure['error'])
        self.assertIn("got '42'", failure['error'])
        state = json.loads((run / 'state.json').read_text())
        self.assertEqual(state['actors']['root']['next'], 1)
        self.assertEqual(state['actors']['root']['pending'], 1)
        self.assertFalse((run / 'work/MUST_NOT_EXIST').exists())
        self.assertFalse((ROOT / '.runtime/never-freeze-fail-fast.json').exists())
        responses = [path.read_text() for path in (run / 'http').glob('*.response')]
        self.assertTrue(any('plot_mismatch' in response for response in responses))
        self.assertFalse((run / 'PASS.json').exists())
        cleanup = json.loads((run / 'cleanup.json').read_text())
        self.assertEqual(len(cleanup['owned']), 3)
        for process in cleanup['owned']:
            self.assertIsNotNone(process['exit'])
            with self.assertRaises(ProcessLookupError):
                os.killpg(process['pid'], 0)
        self.assertEqual(before, {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in baselines})


if __name__ == '__main__':
    unittest.main()
