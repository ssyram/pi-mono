import json
import os
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request


def port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


def http(port_number, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(f'http://127.0.0.1:{port_number}{path}', data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


class OwnedProcesses:
    def __init__(self, run, env):
        self.run = run
        self.env = env
        self.children = []
        self.files = []

    def start(self, name, command):
        log = (self.run / f'{name}.log').open('wb')
        self.files.append(log)
        child = subprocess.Popen(command, cwd=self.run / 'work', env=self.env,
                                 stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        self.children.append(child)
        (self.run / f'{name}.process.json').write_text(json.dumps({'pid': child.pid, 'pgid': child.pid, 'argv': command}))
        return child

    def close(self):
        for child in reversed(self.children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for child in reversed(self.children):
            try:
                child.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
        for log in self.files:
            log.close()


def wait_http(port_number, path, processes, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(child.poll() is not None for child in processes):
            raise RuntimeError('owned service exited during startup')
        try:
            return http(port_number, path)
        except (OSError, urllib.error.URLError):
            time.sleep(0.1)
    raise TimeoutError(f'service startup deadline: {path}')
