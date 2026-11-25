import json
from plot_contract import assert_expectations, normalize
from json_equality import exact_json


def process_identity(run, port, plot, bindings):
    records = json.loads((run / 'fsm-identities.json').read_text())
    process = json.loads((run / 'hc.process.json').read_text())
    spec = plot['observations']['process_identity']
    roots = plot.get('roots', ['root'])
    if type(records) is not list or spec['count'] != len(roots):
        raise ValueError('identity registry schema/count declaration changed')
    assert_expectations(records, [{'path': '', 'length': spec['count']}], bindings)
    result, rules = {}, []
    starts = set()
    for role in roots:
        matches = [record for record in records if record['session_id'] == bindings['session.' + role]]
        if len(matches) != 1:
            raise ValueError('registry does not identify each declared public root exactly once')
        record = matches[0]
        expected = {'agent_pid': process['pid'], 'session_id': bindings['session.' + role], 'cwd': bindings['work'],
                    'opencode_server_url': f'http://127.0.0.1:{port}'}
        for field, value in expected.items():
            if not exact_json(record[field], value):
                raise ValueError(f'FSM identity not bound to owned HC process: {role}/{field}')
        if type(record['start_time']) is not int or record['start_time'] <= 0:
            raise ValueError('invalid process start identity')
        starts.add(record['start_time'])
        result[role] = record
        rules += [{'path': f'/{role}/agent_pid', 'kind': 'binding', 'name': 'process.hc.pid'},
                  {'path': f'/{role}/start_time', 'kind': 'binding', 'name': 'process.hc.start'},
                  {'path': f'/{role}/opencode_server_url', 'kind': 'binding', 'name': 'url.hc'}]
    if len(starts) != 1:
        raise ValueError('same owned HC process has inconsistent start identities')
    bindings.update({'process.hc.pid': process['pid'], 'process.hc.start': starts.pop(), 'url.hc': f'http://127.0.0.1:{port}'})
    return normalize(result, bindings, rules, plot['normalize_bindings'])
