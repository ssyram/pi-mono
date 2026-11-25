import json
import os
import shlex
import signal
import subprocess
import sys
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from plot_engine import load, save
from run_processes import http, port, wait_http
from run_environment import MOCK

ROOT = Path(__file__).resolve().parents[1]


class MockFailFastTests(unittest.TestCase):
    def test_actual_mock_exposes_mismatch_and_refuses_corrected_retry(self):
        run = ROOT / '.runtime/test-evidence' / ('mock-mismatch-' + uuid4().hex[:8])
        for name in ('model-inputs', 'home', 'bin'):
            (run / name).mkdir(parents=True, exist_ok=True)
        (run / 'bin/python3').symlink_to(sys.executable)
        plot = {'golden': str(run / 'must-not-exist.json'), 'actors': {'root': {'marker': 'MOCK_MISMATCH_ROOT', 'result': 'not reached', 'steps': [
            {'tool': 'calculate', 'arguments': {'x': 1}, 'capture': ['toolCallId', 'json'], 'expect': [{'path': '/json/value', 'equals': 2}]}]}}}
        path = run / 'plot.json'
        save(path, plot)
        endpoint = port()
        env = {'HOME': str(run / 'home'), 'PATH': str(run / 'bin') + ':/usr/bin:/bin', 'PLOT_RUN': str(run), 'PLOT_BINDINGS': '{}'}
        with (run / 'mock.log').open('wb') as log:
            process = subprocess.Popen([str(MOCK), '--port', str(endpoint), '--mounts-file', str(run / 'mounts.json')], cwd=run, env=env,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            save(run / 'process.json', {'pid': process.pid, 'port': endpoint})
            try:
                wait_http(endpoint, '/__admin/scripts', [process])
                command = shlex.join([str(ROOT / 'bin/use-plot'), str(path), '--collect'])
                http(endpoint, '/__admin/scripts', {'name': 'intentional-mismatch', 'command': command})
                messages = [{'role': 'user', 'content': 'MOCK_MISMATCH_ROOT'}]
                request = urllib.request.Request(f'http://127.0.0.1:{endpoint}/intentional-mismatch/v1/chat/completions',
                    data=json.dumps({'model': 'plot-model', 'messages': messages, 'stream': True}).encode(), headers={'Content-Type': 'application/json'})
                with urllib.request.urlopen(request, timeout=15) as response:
                    stream = response.read().decode()
                (run / 'first-response.sse').write_text(stream)
                frames = [json.loads(line[6:]) for line in stream.splitlines() if line.startswith('data: ') and line != 'data: [DONE]']
                calls = [call for frame in frames for choice in frame['choices'] for call in choice.get('delta', {}).get('tool_calls', [])]
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0]['function']['name'], 'calculate')
                messages.append({'role': 'assistant', 'content': None, 'tool_calls': [{key: calls[0][key] for key in ('id', 'type', 'function')}]})
                messages.append({'role': 'tool', 'tool_call_id': 'plot_root_000', 'content': '{"value":99}'})
                errors = []
                for value in (99, 2):
                    messages[-1]['content'] = json.dumps({'value': value})
                    with self.assertRaises(urllib.error.HTTPError) as raised:
                        http(endpoint, '/intentional-mismatch/v1/chat/completions', {'model': 'plot-model', 'messages': messages})
                    self.assertEqual(raised.exception.code, 409)
                    errors.append(json.loads(raised.exception.read()))
                save(run / 'observed-http-errors.json', errors)
                self.assertIn('first failure latched', json.dumps(errors[-1]))
                self.assertEqual(load(run / 'state.json', {})['actors']['root']['next'], 0)
                self.assertFalse((run / 'must-not-exist.json').exists())
            finally:
                os.killpg(process.pid, signal.SIGTERM)
                process.wait(timeout=8)
                save(run / 'cleanup.json', {'pid': process.pid, 'exit': process.returncode})


if __name__ == '__main__':
    unittest.main()
