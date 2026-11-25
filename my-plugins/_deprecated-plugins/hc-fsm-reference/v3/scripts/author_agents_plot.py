import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY


def eq(path, value):
    return {'path': path, 'equals': value}


def contains(text):
    return {'path': '/text', 'contains': text}


def bind(path, name, regex):
    return {'path': path, 'bind': name, 'regex': regex}


def tool(name, args, *expect, text=False, **extra):
    return {'tool': name, 'arguments': args, 'capture': ['toolCallId', 'toolName', 'isError', 'text' if text else 'json'],
        'expect': [eq('/toolName', ''), eq('/isError', False), *expect], **extra}


def fsm(name, args, *expect, **extra):
    if name == 'try_transition':
        extra['ledger'] = [{'emit': 'transition.commit.success', 'expect': [eq('/content/to', args['target']), eq('/content/result', 'success')]}]
    return tool('fsm_fsm_' + name, args, *expect, **extra)


def bash(command, expected, **extra):
    return tool('bash', {'command': command, 'description': 'Declared native agent protocol action'}, eq('/text', expected), text=True, **extra)


def send(target, message, **extra):
    return tool('agent_send', {'target': target, 'message': message}, contains('Accepted for ' + target + '.'), text=True, **extra)


def spawn(actor):
    return tool('agent', {'description': 'busy retained ' + actor, 'prompt': 'S05_' + actor.upper() + '_MARKER\nExecute the declared cancellation/resume case.', 'name': actor,
        'subagent_type': 'general', 'cwd': '${work}'}, contains('Started general agent'), bind('/text', 'session.' + actor, 'session_id: (ses_[A-Za-z0-9]+)'), text=True)


def inbox(marker, sender, profile, name=None, regex=None):
    rules = [{'path': '/message', 'contains': '[Agent message from ' + (sender + ' (' + profile + ', ${session.' + sender + '})]' if sender in ('worker', 'leaf') else profile + ' (${session.' + sender + '})]')}]
    if name:
        rules.append(bind('/message', name, regex))
    return {'contains': marker, 'expect': rules}


def check(target, prop):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': prop, 'satisfied': True, 'evidence': 'Observed resumed input, retained variables and actual arithmetic'}]}, eq('/json/status', 'ready'))


def finish(value):
    return [fsm('set_var', {'key': 'result', 'value': value}, eq('/json/ok', True)), check('Done', 'resume and result verified'),
        fsm('try_transition', {'target': 'Done'}, eq('/json/status', 'accept')),
        fsm('get_state', {}, eq('/json/state_status/kind', 'terminal')), check('_fsm_exit', 'committed result verified'),
        fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept'))]


def enter(actor, seed, expected):
    return fsm('enter', {'name': 'BusyRetain', 'vars': {'seed': seed, 'expected': expected}}, eq('/json/state_id', 'Running'),
        eq('/json/const_vars/session_id', '${session.root}'), bind('/json/const_vars/agent_id', 'session.' + actor, '^(ses_[A-Za-z0-9]+)$'))


ABORTED = '(no output)\n\n<shell_metadata>\nUser aborted the command\n</shell_metadata>'


def busy(actor):
    return bash('printf %s "$$" > ' + actor + '.busy.pid; touch ' + actor + '.busy; while :; do sleep 1; done', ABORTED,
        part_expect=[eq('/state/status', 'completed'), eq('/state/output', ABORTED), eq('/state/metadata/exit', None), eq('/state/metadata/truncated', False)])


worker = [enter('worker', '6', '42'), spawn('leaf'), busy('worker'),
    fsm('get_state', {}, eq('/json/fsm_name', 'BusyRetain'), eq('/json/const_vars/seed', '6'), eq('/json/const_vars/agent_id', '${session.worker}'),
        inbox=[inbox('RESUME_WORKER', 'root', 'build')]),
    fsm('get_var_committed', {'key': 'seed'}, eq('/json/value', '6'), bind('/json/value', 'worker.seed', '^(6)$')),
    bash('while ! test -f leaf.sent; do sleep 0.05; done; printf factor-ready', 'factor-ready'),
    fsm('get_state', {}, eq('/json/fsm_name', 'BusyRetain'), inbox=[inbox('LEAF_FACTOR=', 'leaf', 'general', 'worker.factor', 'LEAF_FACTOR=(7)')]),
    bash('printf %s "$((${worker.seed}*${worker.factor}))"', '42')]
worker[-1]['expect'].append(bind('/text', 'worker.result', '^(42)$'))
worker += [*finish('${worker.result}'), send('${session.root}', 'WORKER_VALUE=${worker.result}'), bash('touch worker.sent; printf sent', 'sent')]
leaf = [enter('leaf', '7', '7'), busy('leaf'),
    fsm('get_state', {}, eq('/json/fsm_name', 'BusyRetain'), eq('/json/const_vars/seed', '7'), eq('/json/const_vars/agent_id', '${session.leaf}'),
        inbox=[inbox('RESUME_LEAF', 'root', 'build')]),
    fsm('get_var_committed', {'key': 'seed'}, eq('/json/value', '7'), bind('/json/value', 'leaf.seed', '^(7)$')),
    bash('printf %s "$((${leaf.seed}*1))"', '7')]
leaf[-1]['expect'].append(bind('/text', 'leaf.result', '^(7)$'))
leaf += [*finish('${leaf.result}'), send('${session.worker}', 'LEAF_FACTOR=${leaf.result}'), bash('touch leaf.sent; printf sent', 'sent')]
self_list = 'session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir\n${session.root}\t\tbuild\tself\trunning\tHC FSM reference\t\n\nsession_id always works as a target. A name is shorter but is not guaranteed unique; when two rows share one, use the session_id.'
root = [fsm('get_state', {}, eq('/json/fsm_name', '_default'), eq('/json/const_vars/session_id', '${session.root}')),
    tool('agent_send', {'target': 'no_such_agent_s05', 'message': 'MUST_NOT_DELIVER_UNKNOWN'}, eq('/text', 'No Agent named "no_such_agent_s05" is addressable from here.'), text=True),
    tool('agent_send', {'target': '${session.root}', 'message': 'MUST_NOT_DELIVER_SELF'}, eq('/text', 'Cannot send a message to yourself.'), text=True),
    bash('while ! test -f alien.ready; do sleep 0.05; done; sleep 1; printf foreign-ready', 'foreign-ready'),
    tool('agent_list', {}, eq('/text', self_list), text=True, api_observe={'idle': ['alien'], 'identities': {'root': {'parent': None, 'agent': 'build'}, 'alien': {'parent': None, 'agent': 'build'}}}),
    send('${session.alien}', 'CROSS_INPUT=6'), spawn('worker'),
    bash('while ! test -f worker.busy -a -f leaf.busy; do sleep 0.05; done; printf subtree-started', 'subtree-started'),
    tool('agent_stop', {'target': '${session.worker}'}, contains('Stopped 2 Agent(s): ${session.leaf}, ${session.worker}'), text=True,
        api_observe={'busy': [{'actor': 'worker', 'call': 'plot_worker_002', 'pid_file': '${work}/worker.busy.pid'}, {'actor': 'leaf', 'call': 'plot_leaf_001', 'pid_file': '${work}/leaf.busy.pid'}]}),
    tool('agent_list', {}, contains('\tworker\tgeneral\tchild\tidle\t'), text=True,
        api_observe={'idle': ['worker', 'leaf'], 'dead': ['worker', 'leaf'], 'identities': {'worker': {'parent': 'root', 'agent': 'general'}, 'leaf': {'parent': 'worker', 'agent': 'general'}}}),
    send('${session.worker}', 'RESUME_WORKER'), send('${session.leaf}', 'RESUME_LEAF'),
    bash('while ! test -f worker.sent -a -f alien.finished; do sleep 0.05; done; sleep 1; printf all-results-ready', 'all-results-ready'),
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), api_observe={'idle': ['alien', 'worker', 'leaf'], 'identities': {'alien': {'parent': None, 'agent': 'build'}, 'worker': {'parent': 'root', 'agent': 'general'}, 'leaf': {'parent': 'worker', 'agent': 'general'}}},
        inbox=[inbox('FOREIGN_ACK=', 'alien', 'build', 'root.foreign', 'FOREIGN_ACK=(6)'), inbox('WORKER_VALUE=', 'worker', 'general', 'root.worker', 'WORKER_VALUE=(42)')])]
alien = [fsm('get_state', {}, eq('/json/fsm_name', '_default'), eq('/json/const_vars/session_id', '${session.alien}')),
    bash('touch alien.ready; printf ready', 'ready'), {'kind': 'pause', 'text': 'FOREIGN_ROOT_READY'},
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), inbox=[inbox('CROSS_INPUT=', 'root', 'build', 'alien.input', 'CROSS_INPUT=(6)')]),
    bash('printf %s "$((${alien.input}*1))"', '6')]
alien[-1]['expect'].append(bind('/text', 'alien.result', '^(6)$'))
alien += [send('${session.root}', 'FOREIGN_ACK=${alien.result}'), bash('touch alien.finished; printf finished', 'finished')]
for name, steps in [('root', root), ('alien', alien), ('worker', worker), ('leaf', leaf)]:
    for step in steps:
        if step.get('kind') != 'pause':
            step['hc_agent'] = 'build' if name in ('root', 'alien') else 'general'
            if name in ('root', 'alien'):
                step['persisted_state'] = 'absent'
actors = {'root': {'marker': 'S05_CONTROL_MARKER', 'steps': root, 'result': 'Subagent result: ${root.worker} + ${root.foreign} = ${result}',
    'calculations': [{'operation': 'sum', 'inputs': ['root.worker', 'root.foreign'], 'bind': 'result'}], 'completion_expect': [eq('/result', 'Subagent result: 42 + 6 = 48')]},
    'alien': {'marker': 'S05_FOREIGN_MARKER', 'root': 'alien', 'title': 'Unrelated public root', 'steps': alien, 'result': 'Foreign root processed: ${alien.result}'},
    'worker': {'marker': 'S05_WORKER_MARKER', 'steps': worker, 'result': 'Worker retained result: ${worker.result}'},
    'leaf': {'marker': 'S05_LEAF_MARKER', 'steps': leaf, 'result': 'Leaf retained result: ${leaf.result}'}}
plot = {'golden': str(ROOT / 'golden/native-agents.json'), 'roots': ['root', 'alien'], 'workflows': ['workflows/busy-retain.yaml'],
    'prompt': 'Verify actual public cross-tree addressing and a genuinely busy cancelled subtree retaining its context.',
    'normalize_bindings': ['run', 'work', 'package', *['session.' + name for name in actors]], 'actors': actors,
    'observations': {'fsm_actors': list(actors), 'tool_definitions': {'count': 26, 'required': ['agent', 'agent_list', 'agent_send', 'agent_stop']},
        'completion_reports': [{'sender': 'leaf', 'recipient': 'worker', 'summary': 'Agent completed: busy retained leaf'}, {'sender': 'worker', 'recipient': 'root', 'summary': 'Agent completed: busy retained worker'}],
        'intermediate_stops': [{'name': 'alien.ready', 'actor': 'alien', 'message': 'FOREIGN_ROOT_READY'}],
        'cancellation_reports': [{'recipient': 'root', 'expect': [{'path': '/text', 'contains': '[Agent message from worker (general, ${session.worker})]'}, {'path': '/text', 'contains': 'Its 1 descendant Agent(s) were stopped as well.'}]}],
        'allowed_message_errors': [{'actor': name, 'call': call, 'error': {'name': 'MessageAbortedError', 'data': {'message': 'Aborted'}}, 'part_expect': [eq('/state/status', 'completed'), eq('/state/output', ABORTED), eq('/state/metadata/exit', None)]} for name, call in [('worker', 'plot_worker_002'), ('leaf', 'plot_leaf_001')]],
        'final_actor': {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}, 'process_identity': {'count': 2}, 'matching': POLICY}}
path = ROOT / 'plots/native-agents.json'
if path.exists():
    json.loads(path.read_text())
path.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
