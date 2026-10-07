#!/usr/bin/env python3
"""Exercise the source probe against controlled local responses, never a live source."""
import argparse
import importlib.util
import json
import socket
import threading
import urllib.error
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('weibo_probe', Path(__file__).with_name('probe-weibo.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
valid_item = {'word': '本地测试样本', 'realpos': 1, 'num': 0}
valid = {'ok': 1, 'data': {'band_list': [valid_item]}}
cases = {
    '/valid': (200, valid, 'SUCCESS'),
    '/401': (401, {}, 'AUTH_REQUIRED'),
    '/403': (403, {}, 'ACCESS_DENIED'),
    '/429': (429, {}, 'RATE_LIMITED'),
    '/503': (503, {}, 'SOURCE_UNAVAILABLE'),
    '/visitor': (200, 'Sina Visitor System', 'AUTH_REQUIRED'),
    '/invalid-json': (200, '<html>unrelated response</html>', 'PARSE_FAILED'),
    '/shape-change': (200, {'ok': 1, 'data': {'renamed_list': []}}, 'SOURCE_CHANGED'),
    '/empty': (200, {'ok': 1, 'data': {'band_list': []}}, 'EMPTY_RESULT'),
    '/bad-sixth-item': (200, {'ok': 1, 'data': {'band_list': [valid_item] * 5 + [{}]}}, 'SOURCE_CHANGED'),
    '/bad-heat': (200, {'ok': 1, 'data': {'band_list': [{**valid_item, 'num': '1万'}]}}, 'SOURCE_CHANGED'),
}
calls = Counter()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        calls[self.path] += 1
        assert self.headers.get('Cookie') is None
        status, payload, _ = cases[self.path]
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        if status == 429:
            self.send_header('Retry-After', '60')
        self.end_headers()
        raw = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
        self.wfile.write(raw)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    results = []
    try:
        for path, (_, _, expected) in cases.items():
            result = probe.probe(('controlled-local', (f'http://127.0.0.1:{server.server_port}{path}', 'band_list')))
            assert result['outcome'] == expected, (path, result)
            assert calls[path] == 1, 'Unexpected automatic retry'
            if path == '/429':
                assert result['retry_after'] == '60'
            if path == '/valid':
                item = result['sample'][0]
                assert item['hot_value'] == 0 and item['onboard_time'] is None and item['published_at'] is None
            results.append({'case': path, 'expected': expected, 'result': 'PASS', 'transport': 'localhost HTTP'})
        # Explicit operator recheck after a controlled failure; no time delay is
        # implied here and no real 429 source is contacted.
        recovered = probe.probe(('controlled-local', (f'http://127.0.0.1:{server.server_port}/valid', 'band_list')))
        assert recovered['outcome'] == 'SUCCESS' and calls['/429'] == 1
        results.append({'case': 'explicit-recheck-after-failure', 'result': 'PASS', 'scope': 'new probe succeeds; not worker retry/backoff'})
        with patch.object(probe.urllib.request, 'urlopen', side_effect=urllib.error.URLError(socket.timeout())):
            result = probe.probe(('controlled-timeout', probe.ENDPOINTS['hot_band']))
            assert result['outcome'] == 'TIMEOUT'
        results.append({'case': 'transport-timeout', 'result': 'PASS', 'transport': 'injected timeout; no upstream request'})
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    evidence = {'scope': 'Controlled probe classification and explicit recheck; not production scheduler or source recovery acceptance', 'cases': results, 'result': 'PASS'}
    serialized = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        Path(args.output).write_text(serialized)
    print(serialized)


if __name__ == '__main__':
    main()
