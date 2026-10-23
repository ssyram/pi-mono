import json
from plot_contract import assert_expectations, normalize


def process_identity(run, port, plot, bindings):
    records = json.loads((run / 'fsm-identities.json').read_text())
    process = json.loads((run / 'hc.process.json').read_text())
    spec = plot['observations']['process_identity']
    assert_expectations(records, [{'path': '', 'length': spec['count']}], bindings)
    record = records[0]
    expected = {'agent_pid': process['pid'], 'session_id': bindings['session.root'], 'cwd': bindings['work'],
                'opencode_server_url': f'http://127.0.0.1:{port}'}
    for field, value in expected.items():
        if record[field] != value:
            raise ValueError(f'FSM identity not bound to owned HC process: {field}')
    if type(record['start_time']) is not int or record['start_time'] <= 0:
        raise ValueError('invalid process start identity')
    bindings.update({'process.hc.pid': process['pid'], 'process.hc.start': record['start_time'], 'url.hc': expected['opencode_server_url']})
    rules = [{'path': '/0/agent_pid', 'kind': 'binding', 'name': 'process.hc.pid'},
             {'path': '/0/start_time', 'kind': 'binding', 'name': 'process.hc.start'},
             {'path': '/0/opencode_server_url', 'kind': 'binding', 'name': 'url.hc'}]
    return normalize(records, bindings, rules, plot['normalize_bindings'])
