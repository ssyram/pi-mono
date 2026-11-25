import http.client
import itertools
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from plot_engine import latch
from tool_definition_capture import capture_definitions


def start_proxy(run, upstream_port, plot, mode):
    sequence = itertools.count()
    class Proxy(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def log_message(self, *_):
            pass
        def error_response(self, status, error):
            payload = json.dumps({'error': {'code': 'plot_mismatch', 'message': str(error)}}).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        def do_POST(self):
            number = next(sequence)
            with server.inflight_lock:
                server.inflight += 1
                server.peak_inflight = max(server.peak_inflight, server.inflight)
            try:
                self.forward(number)
            except (OSError, http.client.HTTPException) as error:
                latch(run, error)
                (run / 'http' / f'{number:06d}.transport-error.txt').write_text(str(error))
                if not self.wfile.closed:
                    try:
                        self.error_response(502, error)
                    except OSError as delivery_error:
                        (run / 'http' / f'{number:06d}.error-delivery.txt').write_text(str(delivery_error))
            finally:
                with server.inflight_lock:
                    server.inflight -= 1
        def forward(self, number):
            body = self.rfile.read(int(self.headers['Content-Length']))
            request = json.loads(body)
            (run / 'http' / f'{number:06d}.request.json').write_text(json.dumps(request, ensure_ascii=False, indent=2))
            try:
                if (run / 'FAILURE.json').exists():
                    raise ValueError('first failure latched; refusing provider retry')
                capture_definitions(run, plot, mode, request)
            except Exception as error:
                latch(run, error)
                self.error_response(409, error)
                return
            connection = http.client.HTTPConnection('127.0.0.1', upstream_port, timeout=120)
            connection.request('POST', self.path, body, {'Content-Type': 'application/json'})
            response = connection.getresponse()
            if response.status != 200:
                latch(run, RuntimeError(f'mock returned HTTP {response.status}'))
            self.send_response(response.status)
            self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
            self.send_header('Connection', 'close')
            self.end_headers()
            captured = bytearray()
            try:
                while chunk := response.read1(65536):
                    captured.extend(chunk)
                    self.wfile.write(chunk)
                    self.wfile.flush()
            finally:
                (run / 'http' / f'{number:06d}.response').write_bytes(captured)
                connection.close()
                self.close_connection = True
    server = ThreadingHTTPServer(('127.0.0.1', 0), Proxy)
    server.inflight = 0
    server.peak_inflight = 0
    server.inflight_lock = threading.Lock()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server
