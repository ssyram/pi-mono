from plot_contract import assert_expectations


def transition_ledger(rows, step, bindings):
    expected = step.get('ledger', [])
    paths = ['.'.join(row['emit']) for row in rows]
    if paths != [rule['emit'] for rule in expected]:
        raise ValueError(f'FSM per-call ledger events differ: {paths}')
    for row, rule in zip(rows, expected):
        assert_expectations(row, rule['expect'], bindings)
        if 'duration_ms' in row['content']:
            upper = rule['duration_bound_ms']
            value = row['content']['duration_ms']
            if type(value) is not int or not 0 <= value <= upper:
                raise ValueError('FSM duration violates declared range')
            row['content']['duration_ms'] = f'<duration-ms:0..{upper}>'
    return rows
