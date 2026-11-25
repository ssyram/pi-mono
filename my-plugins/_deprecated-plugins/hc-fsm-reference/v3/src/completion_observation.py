import json
import time
from html import escape
from pathlib import Path
from plot_contract import assert_expectations, expand, normalize
from run_processes import http
from hook_phase_observation import background_hooks
from process_identity_observation import process_identity
from fsm_readonly import actor_summary
from json_equality import exact_json
from actor_identity import actor_identity
from cancelled_run_observation import cancelled_runs
from native_stop_timing import write_native_stop_timing


def quiescent_status(status):
    if type(status) is not dict:
        raise ValueError('HC status response must be an object')
    return len(status) == 0


def completed_stops(run, plot, bindings, actors):
    stops = {}
    for actor in plot['observations']['fsm_actors']:
        session, agent = actor_identity(actor, plot, bindings)
        matches = []
        for path in (run / 'hooks').glob('*.input.json'):
            prefix = Path(str(path).removesuffix('.input.json'))
            if not prefix.with_suffix('.exit').exists():
                continue
            argv = prefix.with_suffix('.argv').read_text().splitlines()
            if argv[0] not in ('stop', 'subagent-stop'):
                continue
            payload = json.loads(path.read_text())
            if payload['session_id'] != session or payload['agent_id'] != agent or payload.get('last_assistant_message') != actors[actor]['result']:
                continue
            expected = 'stop' if agent == 'main' else 'subagent-stop'
            if argv != [expected, '--emit', 'json', '--agent-cli', 'opencode']:
                raise ValueError('normal Stop hook argv mismatch')
            exit_code = int(prefix.with_suffix('.exit').read_text())
            stdout = prefix.with_suffix('.stdout').read_text()
            stderr = prefix.with_suffix('.stderr').read_text()
            if exit_code != 0 or json.loads(stdout)['decision'] != 'allow' or stderr:
                raise ValueError(f'normal Stop failed for {actor}')
            matches.append({'argv': argv, 'input': payload, 'exit': exit_code, 'stdout': stdout, 'stderr': stderr})
        if len(matches) > 1:
            raise ValueError(f'duplicate normal Stop evaluations for {actor}')
        if matches:
            stops[actor] = matches[0]
    return stops


def completion_observation(run, port, plot, state):
    spec = plot.get('observations')
    if not spec:
        return {}
    bindings, actors = state['bindings'], state['actors']
    deadline = time.monotonic() + 30
    while True:
        stops = completed_stops(run, plot, bindings, actors)
        status = http(port, '/session/status')
        quiet = quiescent_status(status)
        if len(stops) == len(spec['fsm_actors']) and quiet:
            break
        if time.monotonic() > deadline:
            raise TimeoutError(f'normal Stop/quiescence not complete: stops={list(stops)}, status={status}')
        time.sleep(0.1)
    all_messages = {}
    final_actors = {}
    for actor in spec['fsm_actors']:
        session, agent = actor_identity(actor, plot, bindings)
        summary = actor_summary(run, session, agent, 'completion-' + actor)
        for field, expected in spec['final_actor'].items():
            if not exact_json(summary[field], expected):
                raise ValueError(f'final FSM actor constraint failed: {actor}/{field}')
        final_actors[actor] = summary
        messages = http(port, f"/session/{bindings['session.' + actor]}/message")
        (run / f'{actor}-messages.json').write_text(json.dumps(messages, ensure_ascii=False, indent=2))
        for message in messages:
            if message['info']['role'] == 'assistant' and (message['info']['providerID'] != 'plot' or message['info']['modelID'] != 'plot-model'):
                raise ValueError('non-mock model used')
        all_messages[actor] = messages
    cancellations_observed = cancelled_runs(run, plot, state, all_messages)
    notifications = {}
    for report in spec['completion_reports']:
        sender, recipient = report['sender'], report['recipient']
        expected = f'<agent id="{bindings["session." + sender]}" state="completed">\n<summary>{escape(report["summary"], quote=False)}</summary>\n<agent_result>\n{escape(expand(report.get("result", actors[sender]["result"]), bindings), quote=False)}\n</agent_result>\n</agent>'
        parts = [part for message in all_messages[recipient] for part in message['parts'] if part.get('metadata', {}).get('kind') == 'agent_notification' and part.get('text') == expected]
        if len(parts) != 1 or parts[0]['text'] != expected:
            raise ValueError(f'native completion report mismatch: {sender}->{recipient}')
        notifications[report.get('name', sender)] = {'recipient': recipient, 'text': parts[0]['text'], 'metadata': parts[0]['metadata']}
    cancellations = []
    for report in spec.get('cancellation_reports', []):
        texts = [part['text'] for message in all_messages[report['recipient']] for part in message['parts'] if part['type'] == 'text' and 'Agent cancelled:' in part['text']]
        if len(texts) != 1:
            raise ValueError('cancellation report cardinality mismatch')
        assert_expectations({'text': texts[0]}, report['expect'], bindings)
        cancellations.append(texts[0])
    definitions = {actor: json.loads((run / f'tool-definitions-{actor}.json').read_text()) for actor in actors}
    expected_reports = len(spec['completion_reports'])
    actual_reports = sum(part.get('metadata', {}).get('kind') == 'agent_notification' for messages in all_messages.values() for message in messages for part in message['parts'])
    if actual_reports != expected_reports:
        raise ValueError('undeclared native completion report')
    write_native_stop_timing(run, plot, state)
    bootstrap = json.loads((run / 'bootstrap-roots.json').read_text())
    result = normalize({'bootstrap_roots': bootstrap, 'normal_stops': stops, 'completion_reports': notifications, 'cancellation_reports': cancellations,
                        'cancelled_runs': cancellations_observed, 'final_actors': final_actors, 'background': background_hooks(run, plot, state), 'process_identity': process_identity(run, port, plot, bindings)}, bindings, [], plot['normalize_bindings'])
    (run / 'completion-observation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return {'completion': result, 'tool_definitions': definitions}
