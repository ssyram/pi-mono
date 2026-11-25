import fcntl
import json
import os
import time
from pathlib import Path
from plot_contract import assert_expectations, expand, normalize
from fsm_observation import observe
from event_tool_settlement import settle_events
from plot_validation import validate_plot


def load(path, fallback):
    return json.loads(path.read_text()) if path.exists() else fallback


def save(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    os.replace(temporary, path)


def latch(run, error):
    try:
        with (run / 'FAILURE.json').open('x') as output:
            json.dump({'error': str(error), 'time': time.time()}, output)
    except FileExistsError:
        pass


def reply(content, tool=False):
    return {'content': content, 'api': 'openai-completions', 'provider': 'plot', 'model': 'plot-model',
            'usage': {'input': 1, 'output': 1, 'cacheRead': 0, 'cacheWrite': 0, 'totalTokens': 2,
                      'cost': {'input': 0, 'output': 0, 'cacheRead': 0, 'cacheWrite': 0, 'total': 0}},
            'stopReason': 'toolUse' if tool else 'stop', 'timestamp': 0}


def actor_for(messages, plot):
    encoded = json.dumps(messages, ensure_ascii=False)
    for actor, spec in sorted(plot['actors'].items(), key=lambda item: -item[1].get('priority', 0)):
        if spec['marker'] in encoded:
            return actor
    raise ValueError('no declared actor marker in transcript')


def receive(step, result, bindings, binding_names):
    available = dict(result)
    available['text'] = '\n'.join(item['text'] for item in result['content'])
    if 'json' in step['capture']:
        available['json'] = json.loads(available['text'])
    receipt = {key: available[key] for key in step['capture']}
    assert_expectations(receipt, step['expect'], bindings)
    return normalize(receipt, bindings, step.get('normalize', []), binding_names)


def process(plot, run, mode, request):
    if (run / 'FAILURE.json').exists():
        raise ValueError('first failure latched; refusing retry')
    messages = request['request']['context']['messages']
    actor = actor_for(messages, plot)
    state_path = run / 'state.json'
    state = load(state_path, {'bindings': json.loads(os.environ.get('PLOT_BINDINGS', '{}')), 'actors': {}, 'receipts': {}})
    if settle_events(plot, run, mode, state, receive):
        save(state_path, state)
    is_new_actor = actor not in state['actors']
    progress = state['actors'].setdefault(actor, {'next': 0, 'pending': None, 'done': False})
    if is_new_actor:
        save(state_path, state)
    bindings = state['bindings']
    steps = plot['actors'][actor]['steps']
    if progress['pending'] is not None:
        index = progress['pending']
        call_id = f'plot_{actor}_{index:03d}'
        results = [item for item in messages if item.get('role') == 'toolResult' and item.get('toolCallId') == call_id]
        if len(results) != 1:
            raise ValueError(f'{actor}/{index}: expected exactly one result for {call_id}, got {len(results)}')
        receipt = receive(steps[index], results[0], bindings, plot.get('normalize_bindings', []))
        observation = observe(run, actor, index, steps[index], plot, bindings)
        if observation is not None:
            receipt['observation'] = observation
        key = f'{actor}/{index:03d}'
        if mode != 'collect':
            expected = load(Path(plot['golden']), {})['receipts'][key]
            if receipt != expected:
                save(run / f'mismatch-{actor}-{index}.json', {'expected': expected, 'actual': receipt})
                raise ValueError(f'golden mismatch at {key}')
        state['receipts'][key] = receipt
        progress['pending'] = None
        progress['next'] += 1
        save(state_path, state)
    index = progress['next']
    if index == len(steps):
        for calculation in plot['actors'][actor].get('calculations', []):
            if calculation['operation'] != 'sum':
                raise ValueError('unsupported declarative calculation')
            bindings[calculation['bind']] = str(sum(int(bindings[name]) for name in calculation['inputs']))
        text = expand(plot['actors'][actor]['result'], bindings)
        assert_expectations({'result': text, 'bindings': bindings}, plot['actors'][actor].get('completion_expect', []), bindings)
        progress['done'] = True
        progress['result'] = text
        save(state_path, state)
        return reply([{'type': 'text', 'text': text}])
    step = steps[index]
    for dependency in step.get('wait_actors', []):
        if dependency not in state['actors']:
            return None
    for dependency in step.get('wait_for', []):
        if dependency not in state['receipts']:
            return None
    for name in step.get('wait_bindings', []):
        if name not in bindings:
            return None
    if step.get('inbox'):
        consumed = []
        users = [item for item in messages if item.get('role') == 'user']
        for observation in step['inbox']:
            matched = [item for item in users if observation['contains'] in json.dumps(item['content'], ensure_ascii=False)]
            if len(matched) != 1:
                raise ValueError(f'inbox requires exactly one message: {observation}')
            assert_expectations({'message': json.dumps(matched[0]['content'], ensure_ascii=False)}, observation['expect'], bindings)
            consumed.append(matched[0])
        consumed = normalize(consumed, bindings, [], plot.get('normalize_bindings', []))
        key = f'{actor}/{index:03d}'
        if mode != 'collect' and consumed != load(Path(plot['golden']), {})['inboxes'][key]:
            raise ValueError(f'consumed inbox golden mismatch at {key}')
        state.setdefault('inboxes', {})[key] = consumed
    if step.get('kind') == 'pause':
        text = expand(step['text'], bindings)
        receipt = {'pause': text}
        key = f'{actor}/{index:03d}'
        if mode != 'collect' and receipt != load(Path(plot['golden']), {})['receipts'][key]:
            raise ValueError(f'pause golden mismatch at {key}')
        state['receipts'][key] = receipt
        progress['next'] += 1
        save(state_path, state)
        return reply([{'type': 'text', 'text': text}])
    arguments = expand(step['arguments'], bindings)
    progress['pending'] = index
    save(state_path, state)
    return reply([{'type': 'toolCall', 'id': f'plot_{actor}_{index:03d}', 'name': step['tool'], 'arguments': arguments}], True)


def settle_pending_events(plot, run, mode):
    with (run / 'state.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if (run / 'FAILURE.json').exists():
            return
        state = load(run / 'state.json', {})
        if settle_events(plot, run, mode, state, receive):
            save(run / 'state.json', state)


def execute(plot_path, run, mode, request):
    plot = json.loads(Path(plot_path).read_text())
    validate_plot(plot)
    deadline = time.monotonic() + plot.get('wait_seconds', 60)
    while True:
        with (run / 'state.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                response = process(plot, run, mode, request)
            except Exception as error:
                latch(run, error)
                raise
        if response is not None:
            return response
        if time.monotonic() >= deadline:
            error = TimeoutError('plot dependency deadline exceeded')
            latch(run, error)
            raise error
        time.sleep(0.05)
