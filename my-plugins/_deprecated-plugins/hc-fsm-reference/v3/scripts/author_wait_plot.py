import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY


def eq(path, value):
    return {'path': path, 'equals': value}


def bind(path, name, regex):
    return {'path': path, 'bind': name, 'regex': regex}


def tool(name, args, *expect, text=False, **extra):
    return {'tool': name, 'arguments': args, 'capture': ['toolCallId', 'toolName', 'isError', 'text' if text else 'json'],
        'expect': [eq('/toolName', ''), eq('/isError', False), *expect], **extra}


def fsm(name, args, *expect, **extra):
    if name == 'try_transition':
        extra['ledger'] = [{'emit': 'transition.commit.success', 'expect': [eq('/content/to', args['target']), eq('/content/result', 'success')]}]
    return tool('fsm_fsm_' + name, args, *expect, **extra)


def bash(command, expected):
    return tool('bash', {'command': command, 'description': 'Semantic wait protocol action'}, eq('/text', expected), text=True)


def check(target, prop):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': prop, 'satisfied': True, 'evidence': 'Observed actual result and retained frame'}]}, eq('/json/status', 'ready'))


pause = 'S09_WAIT_FOR_DESCENDANT'
reason = 'S09_WAIT_ALLOW: the declared busy descendant is executing; retain the frame and wait for its result.'
root = [fsm('enter', {'name': 'SemanticStop'}, eq('/json/fsm_name', 'SemanticStop'), eq('/json/const_vars/session_id', '${session.root}')),
    bash('printf %s "$((6*7))"', '42'), fsm('set_var', {'key': 'amount', 'value': '42'}, eq('/json/ok', True)),
    tool('agent', {'description': 'semantic wait async', 'prompt': 'S09_ASYNC_MARKER\nRun the declared asynchronous arithmetic.', 'name': 'async', 'subagent_type': 'general', 'cwd': '${work}'},
        {'path': '/text', 'contains': 'Started general agent'}, bind('/text', 'session.async', 'session_id: (ses_[A-Za-z0-9]+)'), text=True),
    bash('while ! test -f async.busy; do sleep 0.05; done; printf descendant-started', 'descendant-started'),
    {'kind': 'pause', 'text': pause, 'api_observe': {'busy': [{'actor': 'async', 'call': 'plot_async_002', 'pid_file': '${work}/async.busy.pid'}]}},
    fsm('get_state', {}, eq('/json/state_id', 'Work'), eq('/json/vars_pending/amount', '42'), actor_expect=[eq('/no_progress_count', 0)], stop_phase='wait',
        inbox=[{'contains': 'RESUME_AFTER_SEMANTIC_WAIT', 'expect': [{'path': '/message', 'contains': '[Agent message from build (${session.peer})]'}]}]),
    bash('touch release.async; while ! test -f async.sent; do sleep 0.05; done; sleep 1; printf async-finished', 'async-finished'),
    fsm('get_state', {}, eq('/json/state_id', 'Work'), inbox=[{'contains': 'ASYNC_VALUE=', 'expect': [
        {'path': '/message', 'contains': '[Agent message from async (general, ${session.async})]'}, bind('/message', 'root.async', 'ASYNC_VALUE=(7)')]}]),
    check('Done', 'amount prepared'), fsm('try_transition', {'target': 'Done'}, eq('/json/status', 'accept')),
    fsm('get_state', {}, eq('/json/state_id', 'Done')), check('_fsm_exit', 'Stop exit instruction consumed'), fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept'))]
root[1]['expect'].append(bind('/text', 'root.amount', '^(42)$'))
peer = [fsm('get_state', {}, eq('/json/fsm_name', '_default'), eq('/json/const_vars/session_id', '${session.peer}'), persisted_state='absent'),
    tool('agent_send', {'target': '${session.root}', 'message': 'RESUME_AFTER_SEMANTIC_WAIT'}, {'path': '/text', 'contains': 'Accepted for ${session.root}.'},
        text=True, persisted_state='absent', wait_stop_phase='wait', api_observe={'idle': ['root'], 'identities': {'root': {'parent': None, 'agent': 'build'}}})]
child = [fsm('enter', {'name': 'AsyncWork', 'vars': {'seed': '7'}}, eq('/json/fsm_name', 'AsyncWork'), bind('/json/const_vars/agent_id', 'session.async', '^(ses_[A-Za-z0-9]+)$')),
    fsm('get_var_committed', {'key': 'seed'}, eq('/json/value', '7'), bind('/json/value', 'async.seed', '^(7)$')),
    bash('printf %s "$$" > async.busy.pid; touch async.busy; while ! test -f release.async; do sleep 0.05; done; printf %s "$((${async.seed}*1))"', '7'),
    fsm('set_var', {'key': 'result', 'value': '7'}, eq('/json/ok', True)), check('Done', 'asynchronous result verified'), fsm('try_transition', {'target': 'Done'}, eq('/json/status', 'accept')),
    fsm('get_state', {}, eq('/json/state_id', 'Done')), check('_fsm_exit', 'committed async value verified'), fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept')),
    tool('agent_send', {'target': '${session.root}', 'message': 'ASYNC_VALUE=${async.result}'}, {'path': '/text', 'contains': 'Accepted for ${session.root}.'}, text=True),
    bash('touch async.sent; printf sent', 'sent')]
child[2]['expect'].append(bind('/text', 'async.result', '^(7)$'))
verdict = {'action': 'wait_for_async_work', 'reason': reason}
judge = {'marker': 'WAIT_JUDGE_MARKER', 'stop_for': pause, 'once': True, 'request_capture': ['facts', 'evidence', 'model'],
    'request_expect': [eq('/model', 'plot-model'), eq('/facts/legal_pause', False), eq('/facts/state_id', 'Work'), eq('/facts/is_exit_state', False),
        eq('/facts/recent_stop_plans_present', False), eq('/evidence/recent_stop_plans', None), eq('/evidence/last_assistant_message', pause),
        {'path': '/facts/live_work/confirmed/subjects', 'length': 1}, eq('/facts/live_work/confirmed/subjects/0/kind', 'opencode_session'),
        eq('/facts/live_work/confirmed/subjects/0/pid_or_agent_id', '${session.async}'), {'path': '/facts/live_work/confirmed/subjects/0/description', 'contains': 'semantic wait async'}],
    'steps': [{'tool': 'StructuredOutput', 'arguments': verdict, 'settle_via_event': True, 'capture': ['toolCallId', 'toolName', 'isError', 'input', 'text'],
        'expect': [eq('/toolName', 'StructuredOutput'), eq('/isError', False), eq('/input', verdict), eq('/text', 'Structured output captured successfully.')]}], 'result': reason}
actors = {'root': {'marker': 'S09_WAIT_CONTROL_MARKER', 'steps': root, 'calculations': [{'operation': 'sum', 'inputs': ['root.amount', 'root.async'], 'bind': 'result'}],
    'result': 'Semantic wait result: ${root.amount} + ${root.async} = ${result}', 'completion_expect': [eq('/result', 'Semantic wait result: 42 + 7 = 49')]},
    'peer': {'marker': 'S09_WAIT_PEER_MARKER', 'root': 'peer', 'title': 'Semantic wait controller', 'steps': peer, 'result': 'Semantic wait controller sent resume'},
    'async': {'marker': 'S09_ASYNC_MARKER', 'steps': child, 'result': 'Async arithmetic result: ${async.result}'}, 'judge': judge}
plot = {'golden': str(ROOT / 'golden/semantic-wait.json'), 'roots': ['root', 'peer'], 'wait_seconds': 90,
    'workflows': ['workflows/semantic-stop.yaml', 'workflows/async-work.yaml'], 'prompt': 'Witness real semantic Allow while an actual descendant is busy, then resume the same root and compute.',
    'normalize_bindings': ['run', 'work', 'package', *['session.' + name for name in actors]], 'actors': actors,
    'observations': {'fsm_actors': ['root', 'peer', 'async'], 'completion_reports': [{'sender': 'async', 'recipient': 'root', 'summary': 'Agent completed: semantic wait async'}],
        'stop_phases': [{'name': 'wait', 'actor': 'root', 'message': pause, 'judge': 'judge', 'action': 'wait_for_async_work', 'reason': reason, 'decision': 'allow'}],
        'tool_definitions': {'count': 26, 'required': ['agent', 'fsm_fsm_get_state'], 'actors': {'judge': {'count': 4, 'required': ['StructuredOutput', 'read', 'glob', 'grep']}}},
        'final_actor': {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}, 'process_identity': {'count': 2}, 'matching': POLICY}}
path = ROOT / 'plots/semantic-wait.json'
if path.exists():
    json.loads(path.read_text())
path.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
