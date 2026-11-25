import json
import re
from run_processes import http


def bootstrap_roots(run, port, plot, bindings, save):
    roles = plot.get('roots', ['root'])
    sessions = {}
    for role in roles:
        info = http(port, '/session', {'title': plot['actors'][role].get('title', 'HC FSM reference')})
        if 'parentID' in info or not re.fullmatch('ses_[A-Za-z0-9]+', info['id']):
            raise ValueError('public root creation did not yield an independent root SID')
        if info['id'] in [item['id'] for item in sessions.values()]:
            raise ValueError('root identities are not injective')
        sessions[role] = info
        bindings['session.' + role] = info['id']
        save(run / f'{role}-created.json', info)
    save(run / 'bootstrap-roots.json', {role: {'id': info['id'], 'parentID_present': 'parentID' in info,
        'directory': info['directory'], 'title': info['title']} for role, info in sessions.items()})
    save(run / 'root-session.json', sessions['root'])
    save(run / 'state.json', {'bindings': bindings, 'actors': {}, 'receipts': {}})
    for role, info in sessions.items():
        prompt = plot['actors'][role].get('initial_prompt', plot['prompt'])
        http(port, f"/session/{info['id']}/prompt_async", {'model': {'providerID': 'plot', 'modelID': 'plot-model'},
            'parts': [{'type': 'text', 'text': plot['actors'][role]['marker'] + '\n' + prompt}]})
    return sessions['root']
