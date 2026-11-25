import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY

capture = ['toolCallId', 'toolName', 'isError']
plot = {'golden': str(ROOT / '.runtime/never-freeze-fail-fast.json'), 'workflows': [],
    'prompt': 'Intentional infrastructure mismatch: actual 42 must fail the predeclared 43 expectation. Never execute the following write.',
    'normalize_bindings': ['run', 'work', 'package', 'session.root'],
    'actors': {'root': {'marker': 'PLOT_INTENTIONAL_HC_MISMATCH_6d80', 'result': 'UNREACHABLE', 'steps': [
        {'tool': 'fsm_fsm_get_state', 'arguments': {}, 'capture': [*capture, 'json'], 'persisted_state': 'absent',
         'expect': [{'path': '/json/fsm_name', 'equals': '_default'}, {'path': '/json/const_vars/session_id', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.root'}]},
        {'tool': 'bash', 'arguments': {'command': 'printf %s "$((6*7))"', 'description': 'Intentional mismatch subject'}, 'capture': [*capture, 'text'],
         'expect': [{'path': '/text', 'equals': '43'}]},
        {'tool': 'write', 'arguments': {'filePath': '${work}/MUST_NOT_EXIST', 'content': 'mismatch was not fail-fast'}, 'capture': [*capture, 'text'],
         'expect': [{'path': '/text', 'contains': 'written'}]},
    ]}},
    'observations': {'fsm_actors': ['root'], 'completion_reports': [], 'tool_definitions': {'count': 26, 'required': ['bash', 'write', 'fsm_fsm_get_state']},
        'process_identity': {'count': 1}, 'final_actor': {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}, 'matching': POLICY}}
destination = ROOT / 'plots/fail-fast.json'
if destination.exists():
    json.loads(destination.read_text())
destination.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
