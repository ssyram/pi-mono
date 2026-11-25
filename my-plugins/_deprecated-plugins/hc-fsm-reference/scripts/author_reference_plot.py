import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY
CAPTURE = ['toolCallId', 'toolName', 'isError', 'json']


def eq(path, value):
    return {'path': path, 'equals': value}


def contains(text):
    return {'path': '/text', 'contains': text}


def bind(path, name, regex):
    return {'path': path, 'bind': name, 'regex': regex}


def tool(name, args, *expect, text=False, **extra):
    return {'tool': name, 'arguments': args, 'capture': [*CAPTURE[:-1], 'text' if text else 'json'],
            'expect': [eq('/isError', False), eq('/toolName', ''), *expect], **extra}


def fsm(name, args, *expect, **extra):
    return tool('fsm_fsm_' + name, args, *expect, **extra)


def check(target, property):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': property, 'satisfied': True, 'evidence': 'Validated by preceding receipts and consumed messages'}]}, eq('/json/status', 'ready'))


def transition(target):
    return fsm('try_transition', {'target': target, 'evidence': 'Validated reference action sequence'}, eq('/json/status', 'accept'),
        ledger=[{'emit': 'transition.commit.success', 'expect': [eq('/content/to', target), eq('/content/result', 'success')]}])


def shell(command, expected, **extra):
    return tool('bash', {'command': command, 'description': 'Deterministic plot action'}, eq('/text', expected), text=True, **extra)


def send(target, message, **extra):
    if target.startswith('${'):
        extra.setdefault('wait_bindings', [target[2:-1]])
    return tool('agent_send', {'target': target, 'message': message}, contains('Accepted for '), text=True, **extra)


def launch(actor, **extra):
    return tool('agent', {'description': actor + ' reference arithmetic', 'prompt': 'PLOT_ACTOR_' + actor.upper() + '_6d80\nExecute the deterministic arithmetic reference.', 'subagent_type': 'general', 'name': actor, 'cwd': '${work}'},
                contains('Started general agent'), bind('/text', 'session.' + actor, r'session_id: (ses_[A-Za-z0-9]+)'), text=True, **extra)


def inbox(marker, binding=None, regex=None):
    sender = {'ALPHA_VALUE=': 'alpha', 'BETA_VALUE=': 'beta', 'BETA_ACK=21': 'beta', 'GAMMA_VALUE=': 'gamma', 'SIBLING_VALUE=': 'alpha'}[marker]
    rules = [{'path': '/message', 'contains': '[Agent message from ' + sender + ' (general, ${session.' + sender + '})]'}, contains(marker)]
    rules[1]['path'] = '/message'
    if binding:
        rules.append(bind('/message', binding, regex))
    return {'contains': marker, 'expect': rules}


def state(name, state_id, depth, **extra):
    identity = {'WorkerAlpha': 'alpha', 'WorkerBeta': 'beta', '_default': 'gamma'}.get(name)
    rules = [bind('/json/const_vars/agent_id', 'session.' + identity, r'^(ses_[A-Za-z0-9]+)$')] if identity else []
    if name in ('WorkerAlpha', 'WorkerBeta'):
        rules.append(eq('/json/const_vars/ticket', 'first' if identity == 'alpha' else 'second'))
    return fsm('get_state', {}, eq('/json/fsm_name', name), eq('/json/state_id', state_id), eq('/json/stack_depth', depth), *rules, **extra)


def finish_worker():
    return [fsm('set_var', {'key': 'result', 'value': '21'}, eq('/json/ok', True)), check('Done', 'messages verified'), transition('Done'),
            check('_fsm_exit', 'result delivered'), transition('_fsm_exit')]


root = [
    fsm('enter', {'name': 'Reference', 'vars': {'base': '35'}}, eq('/json/fsm_name', 'Reference'), eq('/json/invariants/0', 'Arithmetic input 35 is immutable'), bind('/json/const_vars/session_id', 'session.root', r'^(ses_[A-Za-z0-9]+)$')),
    fsm('try_transition', {'target': 'Missing'}, eq('/json/status', 'blocked'), eq('/json/reason_code', 'transition_unavailable')),
    fsm('try_transition', {'target': 'Complete'}, eq('/json/status', 'blocked'), eq('/json/reason_code', 'self_check_required')),
    tool('bash', {'command': 'printf forbidden', 'description': 'Predeclared blacklist negative'}, contains('blacklist'), text=True),
    tool('agent', {'description': 'No queue negative', 'prompt': 'Must not start', 'subagent_type': 'general', 'cwd': '${work}'}, contains('requires non-empty dispatch queue'), text=True),
    fsm('set_const_var', {'key': 'tag', 'value': 'immutable'}, eq('/json/ok', True)),
    fsm('set_var', {'key': 'tag', 'value': 'changed'}, contains("variable 'tag' is const and cannot be reassigned"), text=True),
    fsm('get_var_committed', {'key': 'increment'}, eq('/json/value', None)),
    fsm('set_var', {'key': 'increment', 'value': '7'}, eq('/json/ok', True)),
    fsm('get_var_pending', {'key': 'increment'}, eq('/json/value', '7')),
    fsm('dispatch_subagent', {'fsm': 'WorkerAlpha', 'vars': {'ticket': 'first'}}, eq('/json/ok', True)),
    fsm('dispatch_subagent', {'fsm': 'WorkerBeta', 'vars': {'ticket': 'second'}}, eq('/json/ok', True)),
    launch('alpha'), launch('beta'),
    shell('while ! test -f alpha.sent -a -f beta.sent; do sleep 0.05; done; printf messages-ready', 'messages-ready'),
    state('Reference', 'Compute', 2, inbox=[inbox('ALPHA_VALUE=', 'root.alpha', r'ALPHA_VALUE=(\d+)'), inbox('BETA_VALUE=', 'root.beta', r'BETA_VALUE=(\d+)')]),
    check('Complete', 'increment prepared'), transition('Complete'),
    state('Reference', 'Complete', 2),
    fsm('get_var_committed', {'key': 'increment'}, eq('/json/value', '7')),
    fsm('get_var_committed', {'key': 'finished'}, eq('/json/value', 'yes')),
    fsm('enter', {'name': 'Nested'}, contains('allow_enter_fsm is false in current state'), text=True),
    fsm('dispatch_subagent', {'fsm': 'Nested'}, contains('allow_dispatch_subagent=false'), text=True),
    check('_fsm_exit', 'committed result verified'), transition('_fsm_exit'),
    shell('while ! test -f alpha.finished -a -f beta.finished -a -f gamma.finished; do sleep 0.05; done; sleep 1; printf all-finished', 'all-finished'),
    tool('agent_list', {}, contains('\talpha\tgeneral\tchild\tidle\t'), contains('\tbeta\tgeneral\tchild\tidle\t'), text=True),
    tool('agent_stop', {'target': 'alpha'}, contains('Stopped 2 Agent(s):'), text=True),
]
alpha = [state('WorkerAlpha', 'Work', 2), shell('printf %s "$((15+6))"', '21',),
    fsm('enter', {'name': 'Nested'}, eq('/json/stack_depth', 3)), check('_fsm_exit', 'nested result checked'), transition('_fsm_exit'),
    state('WorkerAlpha', 'Work', 2), launch('gamma'),
    send('${session.beta}', 'SIBLING_VALUE=21', wait_bindings=['session.beta']),
    shell('touch alpha.sibling.sent; while ! test -f beta.ack -a -f gamma.sent; do sleep 0.05; done; printf peer-messages-ready', 'peer-messages-ready'),
    state('WorkerAlpha', 'Work', 2, inbox=[inbox('BETA_ACK=21'), inbox('GAMMA_VALUE=', 'alpha.gamma', r'GAMMA_VALUE=(\d+)')]),
    tool('agent_stop', {'target': '${session.beta}'}, contains('direct child'), text=True),
    send('${session.root}', 'ALPHA_VALUE=${alpha.gamma}'), shell('touch alpha.sent; printf sent', 'sent'),
    *finish_worker(), shell('touch alpha.finished; printf finished', 'finished')]
beta = [state('WorkerBeta', 'Work', 2), shell('while ! test -f alpha.sibling.sent; do sleep 0.05; done; printf %s "$((14+7))"', '21'),
    state('WorkerBeta', 'Work', 2, inbox=[inbox('SIBLING_VALUE=', 'beta.alpha', r'SIBLING_VALUE=(\d+)')]),
    send('${session.alpha}', 'BETA_ACK=${beta.alpha}'), shell('touch beta.ack; printf ack', 'ack'),
    send('${session.root}', 'BETA_VALUE=${beta.alpha}'), shell('touch beta.sent; printf sent', 'sent'),
    *finish_worker(), shell('touch beta.finished; printf finished', 'finished')]
gamma = [state('_default', 'S_default', 1), fsm('enter', {'name': 'Nested'}, eq('/json/stack_depth', 2)),
    shell('printf %s "$((3*7))"', '21'), send('${session.alpha}', 'GAMMA_VALUE=21'), shell('touch gamma.sent; printf sent', 'sent'),
    check('_fsm_exit', 'nested result checked'), transition('_fsm_exit'), shell('touch gamma.finished; printf finished', 'finished')]
plot = {'golden': str(ROOT / 'golden/reference-v2.json'), 'workflows': ['workflows/reference.yaml', 'workflows/worker-alpha.yaml', 'workflows/worker-beta.yaml', 'workflows/nested.yaml'],
        'prompt': 'Compute the sum of the two verified child message values. No external models or files.',
        'normalize_bindings': ['run', 'work', 'package', 'session.root', 'session.alpha', 'session.beta', 'session.gamma'],
        'actors': {name: {'marker': 'PLOT_ACTOR_' + name.upper() + '_6d80', 'steps': steps, 'result': name + ' reference arithmetic complete'} for name, steps in [('root', root), ('alpha', alpha), ('beta', beta), ('gamma', gamma)]}}
plot['observations'] = {'fsm_actors': ['root', 'alpha', 'beta', 'gamma'],
    'tool_definitions': {'count': 26, 'required': ['agent', 'agent_send', 'agent_list', 'agent_stop', 'fsm_fsm_enter', 'fsm_fsm_try_transition', 'fsm_fsm_get_state']},
    'completion_reports': [{'sender': actor, 'recipient': parent, 'summary': 'Agent completed: ' + actor + ' reference arithmetic'} for actor, parent in [('alpha', 'root'), ('beta', 'root'), ('gamma', 'alpha')]],
    'cancellation_reports': [{'recipient': 'root', 'expect': [{'path': '/text', 'contains': '[Agent message from alpha (general, ${session.alpha})]'}, {'path': '/text', 'contains': 'Its 1 descendant Agent(s) were stopped as well.'}]}]}
for index, reason in [(3, 'blacklist_matched'), (4, 'requires_dispatch_queue_empty')]:
    root[index].update({'gate': 'deny', 'gate_reason': reason, 'hc_status': 'error'})
root[17]['ledger'].insert(0, {'emit': 'transition.finish', 'duration_bound_ms': 30000, 'expect': [eq('/content/result', 'pass'), eq('/content/finish_failed', 0), eq('/content/finish_total', 1)]})
for index in (6, 21, 22):
    root[index]['hc_status'] = 'error'
gamma[0].update({'persisted_state': 'absent', 'actor_expect': [eq('/fsm_name', '_default'), eq('/state_id', 'S_default'), eq('/stack_depth', 1)]})
for steps in (root, alpha, beta, gamma):
    steps[-1]['state_expect'] = [{'path': '', 'length': 1}, eq('/0/name', '_default')]
plot['actors']['root'].update({'calculations': [{'operation': 'sum', 'inputs': ['root.alpha', 'root.beta'], 'bind': 'result'}], 'result': 'Computed result: ${root.alpha} + ${root.beta} = ${result}'})
plot['actors']['root']['completion_expect'] = [eq('/bindings/root.alpha', '21'), eq('/bindings/root.beta', '21'), eq('/result', 'Computed result: 21 + 21 = 42')]
plot['observations']['final_actor'] = {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}
plot['observations']['process_identity'] = {'count': 1}
plot['observations']['matching'] = POLICY
destination = ROOT / 'plots/reference.json'
if destination.exists():
    json.loads(destination.read_text())
destination.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
