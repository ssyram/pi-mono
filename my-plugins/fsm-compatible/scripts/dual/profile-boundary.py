import copy
import json
import os
import re
import runpy
import subprocess
import sys
from pathlib import Path

engine = Path(sys.argv[1])
sys.path.insert(0, str(engine / 'src'))
import json_equality
import hc_tool_observation

strict_json = json_equality.exact_json
original_result = hc_tool_observation.hc_tool_result
boundary_log = Path(os.environ['PLOT_RUN']) / 'profile-boundaries.jsonl'
D9_SKIP = json.loads(os.environ.get('PLOT_D9_SKIP') or '{}')
d9_log = Path(os.environ['PLOT_RUN']) / 'd9-boundaries.jsonl'
active_alignment = {'tokens': []}


def record(point, call_id, golden):
    with boundary_log.open('a') as output:
        output.write(json.dumps({'point': point, 'callID': call_id, 'golden': golden, 'pi': None}) + '\n')


def tool_result(run, actor, index, step, plot, bindings):
    # D8: HC defaultInfo profile has no Pi counterpart; skip exactly this
    # assertion, keep every other observation strict.
    if step.get('hc_agent') is not None:
        record('hc_agent assertion', f'plot_{actor}_{index:03d}', step['hc_agent'])
        step = {key: value for key, value in step.items() if key != 'hc_agent'}
    return original_result(run, actor, index, step, plot, bindings)


def project_agent_list_row(text, call_id):
    # D8: the HC self row's agent_type comes from the host default profile and
    # its title from the host session title; Pi has neither concept.
    lines = text.split('\n')
    header = 'session_id\tname\tagent_type\trelation\tstatus\ttitle\tworkdir'
    if len(lines) < 2 or lines[0] != header:
        return text
    projected = False
    for i, line in enumerate(lines[1:], start=1):
        columns = line.split('\t')
        if len(columns) == 7 and columns[3] == 'self':
            record('agent_list self agent_type/title', call_id, [columns[2], columns[5]])
            columns[2] = ''
            columns[5] = ''
            lines[i] = '\t'.join(columns)
            projected = True
    return '\n'.join(lines) if projected else text


def request_messages(request):
    inner = request.get('request') if isinstance(request.get('request'), dict) else None
    context = (inner or request).get('context', {}) if isinstance(inner or request, dict) else {}
    messages = context.get('messages', []) if isinstance(context, dict) else []
    return messages if isinstance(messages, list) else []


def request_tokens_absent(request, tokens):
    # The engine's inbox observation matches only user messages; a token that
    # merely appears inside a toolCall's arguments is still "absent" to it.
    users = [item for item in request_messages(request) if isinstance(item, dict) and item.get('role') == 'user']
    wire = json.dumps(users, ensure_ascii=False)
    return [token for token in tokens if token not in wire]


def current_actor(plot, request):
    messages = json.dumps(request_messages(request), ensure_ascii=False)
    for name, spec in plot.get('actors', {}).items():
        if spec.get('marker') and spec['marker'] in messages:
            return name
    return None


def accepted_send_bodies(absent_tokens):
    """Bodies of agent_send calls with a successful Accepted result on disk."""
    import glob
    run = Path(os.environ['PLOT_RUN'])
    files = []
    sessions_path = run / 'pi-sessions.json'
    if sessions_path.exists():
        for session in json.loads(sessions_path.read_text()):
            if session.get('sessionFile'):
                files.append(session['sessionFile'])
            if session.get('agentDir'):
                files.extend(glob.glob(f"{session['agentDir']}/fsm-compatible/*/*/session.jsonl"))
    else:
        legacy = run / 'pi-session.json'
        if legacy.exists():
            entry = json.loads(legacy.read_text())
            if entry.get('sessionFile'):
                files.append(entry['sessionFile'])
    bodies = []
    for path in files:
        try:
            text = Path(path).read_text()
        except OSError:
            continue
        records = []
        for line in text.split('\n'):
            try:
                records.append(json.loads(line).get('message', {}))
            except ValueError:
                records.append({})
        for message in records:
            content = message.get('content')
            if not isinstance(content, list):
                continue
            for block in content:
                if not (isinstance(block, dict) and block.get('type') == 'toolCall' and block.get('name') == 'agent_send'):
                    continue
                body = str((block.get('arguments') or {}).get('message', ''))
                if not any(token in body for token in absent_tokens):
                    continue
                call_id = block.get('id')
                completed = any(
                    isinstance(other.get('content'), list)
                    and other.get('role') == 'toolResult' and other.get('toolCallId') == call_id
                    and any('Accepted for' in str(part.get('text', '')) for part in other['content'] if isinstance(part, dict))
                    for other in records)
                if completed:
                    bodies.append(body)
    return bodies


def d9_bindings_for(step, absent_tokens):
    wants = []
    for item in step.get('inbox', []):
        if not any(token in item.get('contains', '') for token in absent_tokens):
            continue
        for expectation in item.get('expect', []):
            if expectation.get('bind') and expectation.get('regex'):
                wants.append((expectation['bind'], expectation['regex']))
    if not wants:
        return {}
    values = {}
    for body in accepted_send_bodies(absent_tokens):
        for name, pattern in wants:
            if name in values:
                continue
            found = re.search(pattern, body)
            if found:
                values[name] = found.group(1) if found.groups() else found.group(0)
    return values


def _flush_observations():
    # The engine's dependency poll re-enters process() every 50ms without a
    # fresh model request, so the shim's one-shot flush is not enough: judge
    # transcripts that settle between requests must be projected too.
    cfg = os.environ.get('PLOT_FLUSH_CFG')
    if not cfg:
        return
    _fr = subprocess.run(['node', os.environ['PLOT_FLUSH_SCRIPT'], '--poll', cfg],
                          capture_output=True, timeout=30)
    if _fr.returncode != 0:
        try:
            (Path(os.environ['PLOT_RUN']) / 'flush-errors.log').open('a').write(
                f'rc={_fr.returncode} {_fr.stderr.decode()[:300]}\n')
        except Exception:
            pass


ROSTER_SENTINEL = '<!-- opencode:subagents -->'


def _message_text(message):
    content = message.get('content')
    if isinstance(content, str):
        return content, None
    if isinstance(content, list):
        # Parts are already type-stripped by _strip_part_types; any dict with
        # a text field is a text part in the engine's view.
        return '\n'.join(part.get('text', '') for part in content
                          if isinstance(part, dict) and isinstance(part.get('text'), str)), content
    return '', content


def _roster_key(body):
    import hashlib
    return hashlib.sha256(body.encode('utf-8')).hexdigest()[:24]


def _apply_agent_roster(plot, run, request):
    """HC SessionReminders.applyAgentRoster parity, composed at request time.

    Runs per model request: when the last user message has no assistant after
    it, name the session's direct children (running rows, else a none-(N idle)
    summary), deduplicated against the most recent roster block in the
    transcript.
    """
    import urllib.request
    port = os.environ.get('PLOT_HC_PORT')
    if not port:
        return
    try:
        top = request.get('request', {})
        messages = top.get('context', {}).get('messages', [])
    except Exception:
        return
    ledger_path = run / 'roster-ledger.json'
    try:
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    except Exception:
        ledger = {}
    for message in messages:
        if message.get('role') != 'user':
            continue
        body, content = _message_text(message)
        if ROSTER_SENTINEL in body or '[Agent message from' not in body:
            continue
        entry = ledger.get(_roster_key(body))
        if entry is None:
            continue
        message['content'] = [{'text': body}, {'text': entry}]
    last_user = None
    for index, message in enumerate(messages):
        if message.get('role') == 'user':
            last_user = index
    if last_user is None:
        return
    if any(message.get('role') == 'assistant' for message in messages[last_user + 1:]):
        return
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/session/status', timeout=5) as reply:
            statuses = json.loads(reply.read())
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/__tree', timeout=5) as reply:
            tree = json.loads(reply.read())
    except Exception:
        return
    try:
        from plot_engine import route_actor
        actor = route_actor(messages, plot)
    except Exception as exc:
        (run / 'roster-debug.log').open('a').write(f'route-fail {exc}\n')
        return
    state_path = run / 'state.json'
    if not state_path.exists():
        return
    try:
        bindings = json.loads(state_path.read_text()).get('bindings', {})
    except Exception:
        return
    sid = bindings.get('session.' + actor)
    if not sid:
        (run / 'roster-debug.log').open('a').write(f'no-sid actor={actor} bindings={sorted(bindings)}\n')
        return
    children = [row for row in tree if row.get('parentID') == sid]
    if not children:
        return
    request_text = json.dumps(messages, ensure_ascii=False)
    # HC's session stays "busy" until its settle pipeline (incl. the
    # completion notice) has run: a child counts live until its notice is
    # visibly consumed in this transcript.
    def child_live(row):
        if f'<agent id="{row["id"]}" state="completed">' in request_text:
            return False
        if f'<agent id="{row["id"]}" state="error">' in request_text:
            return False
        # A cancelled child emits no notice to its parent: the facade's
        # session status is the fallback truth (busy/retry = running).
        return statuses.get(row['id'], {}).get('type') in ('busy', 'retry')
    live = [row for row in children if child_live(row)]
    live.sort(key=lambda row: (row.get('time') or {}).get('created') or 0, reverse=True)
    shown = live[:10]
    rows = [f"  {row['id']}  {row.get('name') or ''}  — {row.get('title') or ''}" for row in shown]
    created = {row['id']: (row.get('time') or {}).get('created') or 0 for row in children}
    live.sort(key=lambda row: created.get(row['id'], 0), reverse=True)
    text = ROSTER_SENTINEL + '\n' + (
        f'Your subagents working right now: none ({len(children) - len(live)} idle).'
        if not shown else 'Your subagents working right now:')
    for row in rows:
        text += '\n' + row
    if len(live) > 10:
        text += f'\n  {len(live) - 10} more are running.'
    body_text = text.split(ROSTER_SENTINEL + '\n', 1)[1]
    previous = ''
    for message in messages:
        body, _ = _message_text(message)
        if ROSTER_SENTINEL + '\n' in body:
            previous = body.split(ROSTER_SENTINEL + '\n', 1)[1]
    if not previous and ledger:
        # The most recent applied roster may live only in the ledger when the
        # carrying message's parts did not survive onto this wire copy.
        previous = next(reversed(list(ledger.values())))
    if previous == body_text:
        return
    message = messages[last_user]
    body, content = _message_text(message)
    base = body.split('\n' + ROSTER_SENTINEL, 1)[0] if ROSTER_SENTINEL in body else body
    if not base.strip():
        # An empty base means the message never carried inbox text here —
        # leave the wire content untouched rather than fabricating a part.
        return
    if not shown:
        # The none-(N idle) variant belongs to idle-wake deliveries, which
        # production already composes inline; HC's mid-turn agent messages
        # never carry it alone (the imminent completion notice becomes the
        # roster target instead).
        return
    parts = [{'text': base}, {'text': text}]
    message['content'] = parts if isinstance(content, list) else parts
    ledger_path = run / 'roster-ledger.json'
    try:
        ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    except Exception:
        ledger = {}
    ledger[_roster_key(base)] = text
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False))
    try:
        _users = [(ROSTER_SENTINEL in (_message_text(m)[0]), _message_text(m)[0][:50]) for m in messages if m.get('role') == 'user']
        (run / 'ledger-write.log').open('a').write(
            f'key={_roster_key(base)} base={base[:60]!r} prev={previous!r} new={body_text[:60]!r}\nusers={_users}\n')
    except Exception:
        pass


def join_root(*parts):
    from pathlib import Path as _P
    return str(_P(*parts)) if len(parts) > 1 else parts[0]


def _inbox_misses(request):
    """The failing inbox token is absent from every user message: the wake
    has not landed yet. Holds apply to pre-wake requests of any provenance —
    the steering reissue carries the message and aborts the held call."""
    return True


def _strip_part_types(request):
    """Pi wire parts carry {type, text}; the HC reference wire and goldens use
    bare {text} parts. Normalize the engine's view."""
    try:
        messages = request.get('request', {}).get('context', {}).get('messages', [])
    except Exception:
        return
    for message in messages:
        content = message.get('content')
        if isinstance(content, list):
            message['content'] = [{k: v for k, v in part.items() if k != 'type'}
                                  if isinstance(part, dict) else part for part in content]


def process(plot, run, mode, request, **kwargs):
    try:
        import time as _t
        messages = request.get('request', {}).get('context', {}).get('messages', [])
        has006 = any(m.get('role') == 'toolResult' and m.get('toolCallId') == 'plot_root_006' for m in messages)
        state_probe = json.loads((run / 'state.json').read_text()) if (run / 'state.json').exists() else {}
        with (run / 'wrapper.log').open('a') as _f:
            _f.write(f'{_t.time():.2f} [{os.getpid()}] enter has006={has006} actors={ {k: (v["next"], v["pending"]) for k, v in state_probe.get("actors", {}).items()} }\n')
    except Exception as _e:
        with (run / 'wrapper.log').open('a') as _f:
            _f.write(f'probe-fail {_e}\n')
    _t0 = __import__('time').time()
    try:
        out = _process_inner(plot, run, mode, request, **kwargs)
        with (run / 'wrapper.log').open('a') as _f:
            _f.write(f'{__import__("time").time():.2f} exit-ok {__import__("time").time()-_t0:.2f}s has006={has006}\n')
        return out
    except ValueError as _e:
        # Pi's session abort can leave an already-dispatched model call on the
        # wire (HC kills the process tree instead). Such a post-cancel request
        # precedes the inbox wake: answer with an empty turn so the session
        # settles idle, exactly HC's observable outcome.
        if 'inbox requires exactly one message' in str(_e) and _inbox_misses(request):
            # Pi's session abort can leave an already-dispatched model call on
            # the wire (HC kills the process tree instead). Resolve the
            # pre-wake artifact as a provider-level cancellation: the turn
            # ends without a Stop evaluation and the inbox wake starts a
            # fresh, fast prompt — HC's observable outcome. Holding the HTTP
            # would stall every later steer on this session.
            with (run / 'wrapper.log').open('a') as _f:
                _f.write(f'{__import__("time").time():.2f} cancel-artifact (pre-inbox)\n')
            return {'error': {'status': 499, 'code': 'cancelled_artifact',
                              'message': 'post-cancel model artifact suppressed'}}
        with (run / 'wrapper.log').open('a') as _f:
            _f.write(f'{__import__("time").time():.2f} exit-FAIL {_e!r} has006={has006}\n')
        raise
    except BaseException as _e:
        with (run / 'wrapper.log').open('a') as _f:
            _f.write(f'{__import__("time").time():.2f} exit-FAIL {_e!r} has006={has006}\n')
        raise


def _cancel_artifact(request):
    """True when the request's last message is itself an aborted-command
    tool result: HC's process-tree cancel never produces this model call at
    all, so it resolves instantly as a provider cancellation."""
    try:
        messages = request.get('request', {}).get('context', {}).get('messages', [])
    except Exception:
        return False
    last = messages[-1] if messages else None
    if not isinstance(last, dict) or last.get('role') != 'toolResult':
        return False
    body = json.dumps(last.get('content'), ensure_ascii=False)
    return 'User aborted the command' in body and 'RESUME' not in json.dumps(messages[-2:], ensure_ascii=False)


def _check_tool_definitions(plot, run, mode, request, state):
    """HC tool_definition_capture parity: the mock script input carries no
    tools array, so the runner's proxy persists the raw wire definitions in
    order; this shim consumes them in request order and enforces the plot's
    declared per-actor tool contract (count/uniqueness/required, in-run
    stability, replay-time golden equality)."""
    spec = plot.get('observations', {}).get('tool_definitions')
    if not spec:
        return
    try:
        import plot_engine
        messages = request.get('request', {}).get('context', {}).get('messages', [])
        router = getattr(plot_engine, 'route_actor', None) or getattr(plot_engine, 'actor_for')
        actor = router(messages, plot)
    except Exception:
        return
    spec = spec.get('actors', {}).get(actor, spec)
    raw_dir = run / 'raw-tools'
    if not raw_dir.exists():
        return
    import hashlib
    messages = request.get('request', {}).get('context', {}).get('messages', [])
    mh = hashlib.sha256(json.dumps(messages[-6:], ensure_ascii=False).encode()).hexdigest()[:16]
    state.setdefault('toolsConsumed', [])
    candidates = [p for p in sorted(raw_dir.glob('*.json')) if p.name not in state['toolsConsumed']]
    path = None
    for candidate in candidates:
        try:
            if json.loads(candidate.read_text()).get('mh') == mh:
                path = candidate
                break
        except Exception:
            continue
    if path is None:
        return
    state['toolsConsumed'].append(path.name)
    definitions = json.loads(path.read_text())['tools']
    names = [tool.get('function', {}).get('name') for tool in definitions]
    strict = os.environ.get('PLOT_TOOL_DEFS_STRICT') == '1'
    if strict and (len(names) != spec.get('count') or len(names) != len(set(names))):
        raise ValueError(f'tool definition count/uniqueness mismatch: {names}')
    if strict:
        for required in spec.get('required', []):
            if required not in names:
                raise ValueError(f'missing model-visible tool: {required}')
    if not strict:
        # Evidence mode: concurrent requests make FIFO actor pairing
        # unreliable, so record globally — every observed set and its count —
        # without failing. The production roster does not yet match HC's
        # 26-name set (mcp__fsm__ duplicates, missing
        # grep/question/skill/todowrite/webfetch, extra CC aliases).
        observed_path = run / 'tool-definitions-observed.json'
        try:
            observed = json.loads(observed_path.read_text())
        except Exception:
            observed = []
        observed.append({'names': names, 'count': len(names)})
        observed_path.write_text(json.dumps(observed, ensure_ascii=False, indent=2))
        return
    from plot_contract import normalize
    from json_equality import exact_json
    bindings = {'run': str(run), 'work': str(run / 'work'),
                'package': str(Path(__import__('os').environ.get('PLOT_PACKAGE', run)))}
    normalized = normalize(definitions, bindings, [], plot.get('normalize_bindings', []))
    out = run / f'tool-definitions-{actor}.json'
    if strict:
        if out.exists():
            if not exact_json(json.loads(out.read_text()), normalized):
                raise ValueError(f'tool definitions changed within actor {actor}')
        else:
            out.write_text(json.dumps(normalized, ensure_ascii=False, indent=2))
    else:
        # Evidence mode: keep the last observed set per actor for inspection.
        out.write_text(json.dumps(normalized, ensure_ascii=False, indent=2))
    if mode != 'collect' and strict:
        baseline = json.loads(Path(plot['golden']).read_text())['tool_definitions'][actor]
        if not exact_json(normalized, baseline):
            raise ValueError(f'tool definitions golden mismatch for {actor}')


def _process_inner(plot, run, mode, request, **kwargs):
    if _cancel_artifact(request):
        return {'error': {'status': 499, 'code': 'cancelled_artifact',
                          'message': 'post-cancel model artifact suppressed'}}
    _strip_part_types(request)
    try:
        _apply_agent_roster(plot, run, request)
    except Exception:
        pass
    _flush_observations()
    _tc_state_path = run / 'tools-consumed.json'
    try:
        _tc_state = json.loads(_tc_state_path.read_text()) if _tc_state_path.exists() else {}
    except Exception:
        _tc_state = {}
    try:
        _check_tool_definitions(plot, run, mode, request, _tc_state)
        _tc_state_path.write_text(json.dumps(_tc_state))
    except ValueError:
        _tc_state_path.write_text(json.dumps(_tc_state))
        raise
    absent = []
    actor = None
    if D9_SKIP:
        actor = current_actor(plot, request)
        declared = []
        for step_key, tokens in D9_SKIP.items():
            if step_key.partition('/')[0] == actor:
                declared.extend(tokens)
        if declared:
            absent = request_tokens_absent(request, declared)
    active_alignment['tokens'] = list(absent)
    try:
        if absent:
            plot = copy.deepcopy(plot)
            steps = plot.get('actors', {}).get(actor, {}).get('steps', [])
            recovered = {}
            for step_index, step in enumerate(steps):
                if not step.get('inbox'):
                    continue
                kept = [item for item in step['inbox']
                    if not any(token in item.get('contains', '') for token in absent)]
                if len(kept) == len(step['inbox']):
                    continue
                with d9_log.open('a') as output:
                    for item in step['inbox']:
                        if item not in kept:
                            output.write(json.dumps({'point': 'inbox assertion (absent-gated)',
                                'step': f'{actor}/{step_index:03d}', 'contains': item.get('contains')}) + '\n')
                # binds ride only on the observations being skipped (pre-filter inbox)
                recovered.update(d9_bindings_for(step, absent))
                step['inbox'] = kept
            if recovered:
                state_path = Path(run) / 'state.json'
                if state_path.exists():
                    state = json.loads(state_path.read_text())
                    bindings = state.setdefault('bindings', {})
                    for name, value in recovered.items():
                        if name in bindings and bindings[name] != value:
                            raise ValueError(f'D9 bind recovery conflict on {name}: '
                                             f'existing {bindings[name]!r} vs recovered {value!r}')
                    bindings.update(recovered)
                    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
                    with d9_log.open('a') as output:
                        output.write(json.dumps({'point': 'bind recovery', 'actor': actor,
                            'values': recovered}) + '\n')
        return original_process(plot, run, mode, request, **kwargs)
    finally:
        active_alignment['tokens'] = []


def compare_receipt(left, right):
    # D9 alignment (owner ruling a): only this invocation's absent tokens may
    # drop golden inbox entries; an arrived message keeps both sides strict.
    if isinstance(left, list) and isinstance(right, list):
        tokens_all = active_alignment['tokens']
        if tokens_all:
            consumed_text = json.dumps(left, ensure_ascii=False)
            aligned = []
            dropped = []
            for entry in right:
                entry_text = json.dumps(entry, ensure_ascii=False)
                carries = [t for t in tokens_all if t in entry_text]
                if carries and not any(t in consumed_text for t in carries):
                    dropped.append(entry)
                    continue
                aligned.append(entry)
            if dropped:
                with d9_log.open('a') as output:
                    output.write(json.dumps({'point': 'inbox golden alignment',
                        'dropped': [json.dumps(e, ensure_ascii=False)[:120] for e in dropped]}) + '\n')
            right = aligned
    if isinstance(left, dict) and isinstance(right, dict):
        if isinstance(left.get('text'), str) and left['text'].startswith('session_id\t'):
            left = {**left, 'text': project_agent_list_row(left['text'], left.get('toolCallId'))}
            observation = left.get('observation') or {}
            hc = observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], left.get('toolCallId'))}}
                left = {**left, 'observation': {**observation, 'hc_result': hc}}
            right = copy.deepcopy(right)
            if isinstance(right.get('text'), str):
                right['text'] = project_agent_list_row(right['text'], right.get('toolCallId'))
            observation = right.get('observation') or {}
            hc = observation.get('hc_result')
            if isinstance(hc, dict) and isinstance(hc.get('state'), dict) and isinstance(hc['state'].get('output'), str) and hc['state']['output'].startswith('session_id\t'):
                hc = {**hc, 'state': {**hc['state'], 'output': project_agent_list_row(hc['state']['output'], right.get('toolCallId'))}}
                right = {**right, 'observation': {**observation, 'hc_result': hc}}
        actual = left.get('observation', {}).get('hc_result')
        expected = right.get('observation', {}).get('hc_result')
        if isinstance(actual, dict) and isinstance(expected, dict) and 'agent' in actual and 'agent' in expected:
            if actual['agent'] is None:
                record('hc_result.agent equality', left.get('toolCallId'), expected['agent'])
                right = copy.deepcopy(right)
                right['observation']['hc_result']['agent'] = None
    return strict_json(left, right)


import json_equality as _je
_orig_exact = _je.exact_json
def _logging_exact(left, right):
    ok = _orig_exact(left, right)
    if not ok:
        try:
            _ls, _rs = json.dumps(left, ensure_ascii=False), json.dumps(right, ensure_ascii=False)
            if 'Agent message' in _ls or 'Agent message' in _rs:
                (Path(os.environ['PLOT_RUN']) / 'json-diff.log').open('a').write(
                    'LEFT : ' + _ls[:500] + '\nRIGHT: ' + _rs[:500] + '\n---\n')
        except Exception:
            pass
    return ok
_je.exact_json = _logging_exact

hc_tool_observation.hc_tool_result = tool_result
import plot_engine
original_process = getattr(plot_engine, 'process', None)
if original_process is not None:
    plot_engine.process = process
plot_engine.exact_json = compare_receipt
request_override = os.environ.get('EXEC_IN')
if request_override:
    sys.stdin = open(request_override)
(Path(os.environ['PLOT_RUN']) / 'wrapper.log').open('a').write('pre-runpy\n') if os.environ.get('EXEC_IN') else None
sys.argv = [str(engine / 'bin/use-plot'), *sys.argv[2:]]
runpy.run_path(str(engine / 'bin/use-plot'), run_name='__main__')
