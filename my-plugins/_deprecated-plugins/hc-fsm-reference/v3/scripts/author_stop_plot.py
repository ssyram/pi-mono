import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from observation_policy import POLICY


def eq(path, value):
    return {'path': path, 'equals': value}


def tool(name, args, *expect, text=False, **extra):
    return {'tool': name, 'arguments': args, 'capture': ['toolCallId', 'toolName', 'isError', 'text' if text else 'json'],
            'expect': [eq('/toolName', ''), eq('/isError', False), *expect], **extra}


def fsm(name, args, *expect, **extra):
    if name == 'try_transition':
        extra['ledger'] = [{'emit': 'transition.commit.success', 'expect': [eq('/content/to', args['target']), eq('/content/result', 'success')]}]
    return tool('fsm_fsm_' + name, args, *expect, **extra)


def check(target, prop):
    return fsm('submit_self_check', {'target': target, 'checks': [{'property': prop, 'satisfied': True, 'evidence': 'Actual arithmetic, Stop verdict and continuation observed'}]}, eq('/json/status', 'ready'))


pauses = ['S09_PAUSE_A: work remains', 'S09_PAUSE_B: inspect before completion', 'S09_PAUSE_C: still no transition', 'S09_PAUSE_D: terminal frame not released']
reasons = ['S09_CONTINUE_A: continue the declared Work state on this same session.',
           'S09_OBSERVE_B: immediately inspect the current full state on this same session.',
           'S09_CONTINUE_C: three non-progress plans do not authorize stopping; complete the declared transition.',
           'S09_EXIT_D: self-check the offered _fsm_exit target and release this exact terminal frame.']
actions = ['continue_work', 'arrange_observation', 'continue_work', 'exit_fsm']
root = [
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), eq('/json/const_vars/session_id', '${session.root}'), persisted_state='absent'),
    tool('agent', {'description': 'semantic stop subject', 'prompt': 'S09_SUBJECT_MARKER\nRun the declared semantic Stop progression.', 'subagent_type': 'general', 'name': 'subject', 'cwd': '${work}'},
         {'path': '/text', 'contains': 'Started general agent'}, {'path': '/text', 'regex': 'session_id: (ses_[A-Za-z0-9]+)', 'bind': 'session.subject'}, text=True, persisted_state='absent'),
    tool('bash', {'command': 'while ! test -f subject.sent; do sleep 0.05; done; sleep 1; printf subject-finished', 'description': 'Wait for actual subject message and completion'}, eq('/text', 'subject-finished'), text=True, persisted_state='absent'),
    fsm('get_state', {}, eq('/json/fsm_name', '_default'), persisted_state='absent', inbox=[{'contains': 'S09_VALUE=', 'expect': [
        {'path': '/message', 'contains': '[Agent message from subject (build, ${session.subject})]'}, {'path': '/message', 'regex': 'S09_VALUE=(42)', 'bind': 'root.value'}]}]),
]
subject = [fsm('enter', {'name': 'SemanticStop'}, eq('/json/fsm_name', 'SemanticStop'), eq('/json/const_vars/session_id', '${session.root}'),
    {'path': '/json/const_vars/agent_id', 'regex': '^(ses_[A-Za-z0-9]+)$', 'bind': 'session.subject'}),
    tool('bash', {'command': 'printf %s "$((6*7))"', 'description': 'Compute actual amount before Stop attempts'}, eq('/text', '42'), {'path': '/text', 'regex': '^(42)$', 'bind': 'subject.amount'}, text=True),
    fsm('set_var', {'key': 'amount', 'value': '${subject.amount}'}, eq('/json/ok', True))]
for number in range(3):
    subject += [{'kind': 'pause', 'text': pauses[number]},
        fsm('get_state', {}, eq('/json/state_id', 'Work'), eq('/json/vars_pending/amount', '42'), stop_phase='phase' + str(number + 1),
            inbox=[{'contains': reasons[number], 'expect': [{'path': '/message', 'contains': reasons[number]}]}])]
subject += [check('Done', 'amount prepared'), fsm('try_transition', {'target': 'Done'}, eq('/json/status', 'accept')),
    {'kind': 'pause', 'text': pauses[3]},
    fsm('get_state', {}, eq('/json/state_id', 'Done'), eq('/json/state_status/kind', 'terminal'), stop_phase='phase4',
        inbox=[{'contains': reasons[3], 'expect': [{'path': '/message', 'contains': reasons[3]}]}]),
    check('_fsm_exit', 'Stop exit instruction consumed'), fsm('try_transition', {'target': '_fsm_exit'}, eq('/json/status', 'accept')),
    tool('agent_send', {'target': '${session.root}', 'message': 'S09_VALUE=${subject.amount}'}, {'path': '/text', 'contains': 'Accepted for ${session.root}.'}, text=True),
    tool('bash', {'command': 'touch subject.sent; printf sent', 'description': 'Publish declared send completion'}, eq('/text', 'sent'), text=True)]
for index, step in enumerate(subject):
    if step.get('kind') != 'pause':
        step['hc_agent'] = 'general' if index < 3 else 'build'
actors = {'root': {'marker': 'S09_CONTROL_MARKER', 'steps': root, 'result': 'Semantic Stop result: ${root.value}', 'completion_expect': [eq('/result', 'Semantic Stop result: 42')]},
          'subject': {'marker': 'S09_SUBJECT_MARKER', 'steps': subject, 'result': 'Stop subject result: ${subject.amount}'}}
phases = []
for index, action in enumerate(actions):
    name = 'judge' + str(index + 1)
    verdict = {'action': action, 'reason': reasons[index]}
    expect = [eq('/model', 'plot-model'), eq('/evidence/last_assistant_message', pauses[index]), eq('/facts/legal_pause', False),
              eq('/facts/fsm_name', 'SemanticStop'), eq('/facts/state_id', 'Done' if index == 3 else 'Work'), eq('/facts/is_exit_state', index == 3),
              eq('/facts/live_work', 'none'), eq('/facts/recent_stop_plans_present', index == 2), eq('/evidence/recent_stop_plans', pauses[:3] if index == 2 else None)]
    actors[name] = {'marker': 'STOP_JUDGE_' + str(index + 1), 'stop_for': pauses[index], 'once': True,
        'request_capture': ['facts', 'evidence', 'model'], 'request_expect': expect,
        'steps': [{'tool': 'StructuredOutput', 'arguments': verdict, 'settle_via_event': True,
                  'capture': ['toolCallId', 'toolName', 'isError', 'input', 'text'],
                  'expect': [eq('/toolName', 'StructuredOutput'), eq('/isError', False), eq('/input', verdict), eq('/text', 'Structured output captured successfully.')]}],
        'result': reasons[index]}
    phases.append({'name': 'phase' + str(index + 1), 'actor': 'subject', 'message': pauses[index], 'judge': name,
        'action': action, 'reason': reasons[index], 'decision': 'block', 'count': index + 1 if index < 3 else 1})
reports = [{'name': 'subject.pause' + str(index + 1), 'sender': 'subject', 'recipient': 'root', 'summary': 'Agent completed: semantic stop subject', 'result': text} for index, text in enumerate(pauses)]
reports.append({'name': 'subject.final', 'sender': 'subject', 'recipient': 'root', 'summary': 'Agent completed: semantic stop subject'})
plot = {'golden': str(ROOT / 'golden/semantic-stop.json'), 'workflows': ['workflows/semantic-stop.yaml'],
    'prompt': 'Verify actual semantic Stop judgments and same-SID continuations, then deliver actual arithmetic.',
    'normalize_bindings': ['run', 'work', 'package', *['session.' + name for name in actors]], 'actors': actors,
    'observations': {'fsm_actors': ['root', 'subject'], 'completion_reports': reports, 'stop_phases': phases,
        'tool_definitions': {'count': 26, 'required': ['agent', 'fsm_fsm_get_state'], 'actors': {name: {'count': 4, 'required': ['StructuredOutput', 'read', 'glob', 'grep']} for name in actors if name.startswith('judge')}},
        'final_actor': {'fsm_name': '_default', 'state_id': 'S_default', 'stack_depth': 1, 'is_terminal': True, 'no_progress_count': 0},
        'process_identity': {'count': 1}, 'matching': POLICY}}
path = ROOT / 'plots/semantic-stop.json'
if path.exists():
    json.loads(path.read_text())
path.write_text(json.dumps(plot, ensure_ascii=False, indent=2) + '\n')
