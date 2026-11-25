import http.client
import json
import socket
from urllib.parse import quote


class UnixConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=10)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(10)
        self.sock.connect(str(self.path))


def actor_summary(run, root_session, agent_id, call_id):
    connection = UnixConnection(run / 'fsm/server.sock')
    token = (run / 'fsm/auth.token').read_text().strip()
    connection.request('GET', f'/session/{quote(root_session)}/actors', headers={'x-fsm-auth': token})
    response = connection.getresponse()
    body = response.read()
    connection.close()
    if response.status != 200:
        raise ValueError(f'read-only actor query failed: HTTP {response.status}')
    data = json.loads(body)
    (run / 'fsm-states' / f'actors-{call_id}.json').write_bytes(body)
    actors = [actor for actor in data['actors'] if actor['agent_id'] == agent_id]
    if len(actors) != 1:
        raise ValueError('read-only actor query did not identify exactly one actor')
    return actors[0]
