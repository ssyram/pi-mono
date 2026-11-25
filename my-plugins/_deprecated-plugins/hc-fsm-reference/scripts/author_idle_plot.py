import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY


def eq(path, value):
    return {'path': path, 'equals': value}


def tool(name, arguments, *expect, text=False, **extra):
    return {'tool': name, 'arguments': arguments, 'capture': ['toolCallId', 'toolName', 'isError', 'text' if text else 'json'],
            'expect': [eq('/toolName', ''), eq('/isError', False), *expect], **extra}


def fsm(name, arguments, *expect, **extra):
    if name == 'try_transition':
        extra['ledger'] = [{'emit': 'transition.commit.success', 'expect': [eq('/content/to', arguments['target']), eq('/content/result', 'success')]}]
    return tool('fsm_fsm_' + name, arguments, *expect, **extra)


def shell(command, expected):
    return tool('bash', {'command': command, 'description': 'Idle resume reference action'}, eq('/text', expected), text=True)


def check(target, property):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': property, 'satisfied': True, 'evidence': 'Observed retained frame and resumed message'}]}, eq('/json/status', 'ready'))


root = [
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), {'path': '/json/const_vars/session_id', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.root'}),
    tool('agent', {'description': 'worker idle resume arithmetic', 'prompt': 'PLOT_IDLE_WORKER_6d80\nRun the declared two-phase arithmetic case.', 'subagent_type': 'general', 'name': 'worker', 'cwd': '${work}'},
         {'path': '/text', 'contains': 'Started general agent'}, {'path': '/text', 'regex': 'session_id: (ses_[A-Za-z0-9]+)', 'bind': 'session.worker'}, text=True),
    shell('while ! test -f worker.paused; do sleep 0.05; done; sleep 1; printf pause-reached', 'pause-reached'),
    tool('agent_list', {}, {'path': '/text', 'contains': '\tworker\tgeneral\tchild\tidle\t'}, text=True),
    tool('agent_stop', {'target': 'worker'}, {'path': '/text', 'contains': 'Stopped 1 Agent(s): ${session.worker}'}, text=True),
    tool('agent_send', {'target': 'worker', 'message': 'RESUME_SAME_SESSION'}, {'path': '/text', 'contains': 'Accepted for ${session.worker}.'}, text=True),
    shell('while ! test -f worker.finished; do sleep 0.05; done; sleep 1; printf resumed', 'resumed'),
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), inbox=[{'contains': 'RESUME_VALUE=', 'expect': [
        {'path': '/message', 'contains': '[Agent message from worker (general, ${session.worker})]'},
        {'path': '/message', 'regex': 'RESUME_VALUE=(\\d+)', 'bind': 'result'}]}]),
    tool('agent_list', {}, {'path': '/text', 'contains': '\tworker\tgeneral\tchild\tidle\t'}, text=True),
]
worker = [
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), {'path': '/json/const_vars/agent_id', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.worker'}, persisted_state='absent'),
    fsm('enter', {'name': 'IdleResume'}, eq('/json/fsm_name', 'IdleResume'), eq('/json/state_id', 'Await')),
    fsm('set_const_var', {'key': 'remembered', 'value': '6'}, eq('/json/ok', True)),
    shell('touch worker.paused; printf paused', 'paused'),
    {'kind': 'pause', 'text': 'Awaiting verified resume'},
    fsm('get_state', {}, eq('/json/fsm_name', 'IdleResume'), eq('/json/const_vars/remembered', '6'), eq('/json/const_vars/agent_id', '${session.worker}'), inbox=[
        {'contains': 'RESUME_SAME_SESSION', 'expect': [{'path': '/message', 'contains': '[Agent message from build (${session.root})]'}]}]),
    fsm('get_var_committed', {'key': 'remembered'}, eq('/json/value', '6'), {'path': '/json/value', 'regex': '^(6)$', 'bind': 'remembered'}),
    shell('printf %s "$((${remembered}*7))"', '42'),
    check('Done', 'resume message consumed'), fsm('try_transition', {'target': 'Done'}, eq('/json/status', 'accept')),
    check('_fsm_exit', 'retained value verified'), fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept')),
    tool('agent_send', {'target': '${session.root}', 'message': 'RESUME_VALUE=42'}, {'path': '/text', 'contains': 'Accepted for ${session.root}.'}, text=True),
    shell('touch worker.finished; printf finished', 'finished'),
]
worker[7]['expect'].append({'path': '/text', 'regex': '^(42)$', 'bind': 'computed'})
worker[12]['arguments']['message'] = 'RESUME_VALUE=${computed}'
for step in root:
    step['persisted_state'] = 'absent'
plot = {'golden': str(ROOT / 'golden/idle-resume-v2.json'), 'workflows': ['workflows/idle-resume.yaml'],
    'prompt': 'Verify idle/stop/resume without recreating or cloning the session.',
    'normalize_bindings': ['run', 'work', 'package', 'session.root', 'session.worker'],
    'actors': {'root': {'marker': 'PLOT_IDLE_ROOT_6d80', 'steps': root, 'result': 'Idle-resume result: ${result}'},
               'worker': {'marker': 'PLOT_IDLE_WORKER_6d80', 'steps': worker, 'result': 'Retained arithmetic result: ${computed}'}},
    'observations': {'fsm_actors': ['root', 'worker'], 'tool_definitions': {'count': 26, 'required': ['agent', 'agent_stop', 'agent_send', 'fsm_fsm_get_state']},
        'intermediate_stops': [{'name': 'worker.pause', 'actor': 'worker', 'message': 'Awaiting verified resume'}],
        'completion_reports': [{'name': 'worker.pause', 'sender': 'worker', 'recipient': 'root', 'summary': 'Agent completed: worker idle resume arithmetic', 'result': 'Awaiting verified resume'},
                               {'name': 'worker.final', 'sender': 'worker', 'recipient': 'root', 'summary': 'Agent completed: worker idle resume arithmetic'}],
        'cancellation_reports': [{'recipient': 'root', 'expect': [{'path': '/text', 'contains': 'Agent cancelled: worker (general)'}]}]}}
plot['actors']['root']['completion_expect'] = [eq('/bindings/result', '42'), eq('/result', 'Idle-resume result: 42')]
plot['observations']['final_actor'] = {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0}
plot['observations']['process_identity'] = {'count': 1}
plot['observations']['matching'] = POLICY
destination = ROOT / 'plots/idle-resume.json'
if destination.exists():
    json.loads(destination.read_text())
destination.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
