import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY


def eq(path, value):
    return {'path': path, 'equals': value}


def tool(name, arguments, *expect, text=False):
    return {'tool': name, 'arguments': arguments, 'capture': ['toolCallId', 'toolName', 'isError', 'text' if text else 'json'],
            'expect': [eq('/toolName', ''), eq('/isError', False), *expect]}


def fsm(name, arguments, *expect):
    step = tool('fsm_fsm_' + name, arguments, *expect)
    if name == 'try_transition':
        step['ledger'] = [{'emit': 'transition.commit.success', 'expect': [eq('/content/to', arguments['target']), eq('/content/result', 'success')]}]
    return step


def check(target, property):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': property, 'satisfied': True, 'evidence': 'Actual arithmetic and independent read receipts verified'}]}, eq('/json/status', 'ready'))


root = [
    fsm('enter', {'name': 'SoftReview'}, eq('/json/fsm_name', 'SoftReview'), {'path': '/json/const_vars/session_id', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.root'}),
    tool('bash', {'command': 'printf %s "$((6*7))" | tee arithmetic.txt', 'description': 'Compute actual review artifact'}, eq('/text', '42'), {'path': '/text', 'regex': '^(42)$', 'bind': 'root.value'}, text=True),
    fsm('set_const_var', {'key': 'amount', 'value': '${root.value}'}, eq('/json/ok', True)),
    check('Complete', 'arithmetic artifact prepared'),
    fsm('try_transition', {'target': 'Complete', 'evidence': 'arithmetic.txt is 42'}, eq('/json/status', 'accept'), eq('/json/review_feedback', ['Check A verified 42', 'Check B verified 42'])),
    fsm('get_var_committed', {'key': 'soft_finished'}, eq('/json/value', 'yes')),
    check('_fsm_exit', 'review feedback consumed'), fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept')),
]
actors = {'root': {'marker': 'PLOT_SOFT_ROOT_6d80', 'steps': root, 'result': 'Soft-review result: ${root.value}'}}
for letter, other in [('A', 'B'), ('B', 'A')]:
    name = 'review' + letter
    read = tool('read', {'filePath': '${work}/arithmetic.txt'}, {'path': '/text', 'regex': '(?m)^1: 42$'}, text=True)
    read['wait_actors'] = ['review' + other]
    verdict = {'checks': [{'criterion': 'arithmetic.txt contains exactly 42', 'passed': True, 'reason': 'Read the actual arithmetic artifact and observed 42'}],
               'overall_passed': True, 'blocking_issues': [], 'summary': 'Check ' + letter + ' verified ${root.value}'}
    terminal = {'tool': 'StructuredOutput', 'arguments': verdict, 'settle_via_event': True,
        'capture': ['toolCallId', 'toolName', 'isError', 'input', 'text'],
        'expect': [eq('/toolName', 'StructuredOutput'), eq('/isError', False), eq('/input', verdict),
                   eq('/text', 'Structured output captured successfully.'), {'path': '/input/summary', 'regex': '^(Check ' + letter + ' verified 42)$', 'bind': name + '.summary'}]}
    actors[name] = {'marker': 'PLOT_SOFT_REVIEW_' + letter + '_6d80', 'priority': 100, 'steps': [read, terminal], 'result': '${' + name + '.summary}'}
plot = {'golden': str(ROOT / 'golden/soft-review-v2.json'), 'workflows': ['workflows/soft-review.yaml'], 'wait_seconds': 60,
    'prompt': 'Exercise real FSM parallel soft-review gates using only the local mocked reviewer model.',
    'normalize_bindings': ['run', 'work', 'package', 'session.root', 'session.reviewA', 'session.reviewB'], 'actors': actors,
    'observations': {'fsm_actors': ['root'], 'completion_reports': [], 'minimum_model_concurrency': 2,
        'tool_definitions': {'count': 26, 'required': ['fsm_fsm_try_transition'],
            'actors': {name: {'count': 4, 'required': ['StructuredOutput', 'read', 'glob', 'grep']} for name in ('reviewA', 'reviewB')}}}}
root[4]['ledger'] = [
    {'emit': 'review.pass', 'expect': [eq('/content/decision', 'pass'), eq('/content/detail', 'Check ' + letter + ' verified 42')]} for letter in ('A', 'B')
] + [{'emit': 'transition.finish', 'duration_bound_ms': 30000, 'expect': [eq('/content/result', 'pass'), eq('/content/soft_total', 2), eq('/content/finish_failed', 0)]}, *root[4]['ledger']]
plot['actors']['root']['completion_expect'] = [eq('/bindings/root.value', '42'), eq('/result', 'Soft-review result: 42')]
plot['observations']['final_actor'] = {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}
plot['observations']['process_identity'] = {'count': 1}
plot['observations']['matching'] = POLICY
destination = ROOT / 'plots/soft-review.json'
if destination.exists():
    json.loads(destination.read_text())
destination.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
