import json
from pathlib import Path
from actor_identity import actor_identity
from plot_contract import expand


def write_native_stop_timing(run, plot, state):
    bindings = state['bindings']
    rows = []
    for phase in plot['observations'].get('stop_phases', []):
        actor = phase['actor']
        text = expand(phase['message'], bindings)
        messages = json.loads((run / f'{actor}-messages.json').read_text())
        turns = [message for message in messages if message['info']['role'] == 'assistant' and any(part.get('text') == text for part in message['parts'])]
        if len(turns) != 1:
            raise ValueError('Stop phase does not identify one actual completed assistant turn')
        session, agent = actor_identity(actor, plot, bindings)
        hooks = []
        for path in (run / 'hooks').glob('*.input.json'):
            prefix = Path(str(path).removesuffix('.input.json'))
            if not prefix.with_suffix('.exit').exists():
                continue
            payload = json.loads(path.read_text())
            if payload.get('session_id') == session and payload.get('agent_id') == agent and payload.get('last_assistant_message') == text:
                hooks.append(prefix)
        if len(hooks) != 1:
            raise ValueError('Stop timing cannot locate unique hook')
        prefix = hooks[0]
        notices = []
        for report in plot['observations']['completion_reports']:
            if report['sender'] != actor or expand(report.get('result', ''), bindings) != text:
                continue
            parent = json.loads((run / (report['recipient'] + '-messages.json')).read_text())
            for message in parent:
                for part in message['parts']:
                    if part.get('metadata', {}).get('kind') == 'agent_notification' and text in part.get('text', ''):
                        notices.append({'parent_session': message['info']['sessionID'], 'message': message['info']['id'], 'part': part['id'], 'created_ms': message['info']['time']['created']})
        rows.append({'phase': phase['name'], 'subject_session': bindings['session.' + actor], 'assistant': turns[0]['info']['id'],
            'assistant_agent': turns[0]['info']['agent'], 'assistant_completed_ms': turns[0]['info']['time']['completed'],
            'hook_input_mtime_ms': prefix.with_suffix('.input.json').stat().st_mtime_ns / 1000000,
            'hook_exit_mtime_ms': prefix.with_suffix('.exit').stat().st_mtime_ns / 1000000, 'native_parent_notices': notices})
    (run / 'native-stop-timing.json').write_text(json.dumps({'ordering_contract': 'independent native report and FSM verdict lanes; no global happens-before assertion', 'observations': rows}, ensure_ascii=False, indent=2))
