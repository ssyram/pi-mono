import json
from pathlib import Path
from plot_contract import normalize
from plot_engine import actor_for, latch


def capture_definitions(run, plot, mode, request):
    actor = actor_for(request['messages'], plot)
    spec = plot.get('observations', {}).get('tool_definitions')
    if not spec:
        return
    spec = spec.get('actors', {}).get(actor, spec)
    definitions = request['tools']
    names = [tool['function']['name'] for tool in definitions]
    if len(names) != spec['count'] or len(names) != len(set(names)):
        raise ValueError(f'tool definition count/uniqueness mismatch: {names}')
    for required in spec['required']:
        if required not in names:
            raise ValueError(f'missing model-visible tool: {required}')
    bindings = {'run': str(run), 'work': str(run / 'work'), 'package': str(Path(__file__).resolve().parents[1])}
    normalized = normalize(definitions, bindings, [], plot.get('normalize_bindings', []))
    path = run / f'tool-definitions-{actor}.json'
    if path.exists():
        if json.loads(path.read_text()) != normalized:
            raise ValueError(f'tool definitions changed within actor {actor}')
    else:
        with path.open('x') as output:
            json.dump(normalized, output, ensure_ascii=False, indent=2)
    if mode != 'collect':
        baseline = json.loads(Path(plot['golden']).read_text())['tool_definitions'][actor]
        if normalized != baseline:
            raise ValueError(f'tool definitions golden mismatch for {actor}')
