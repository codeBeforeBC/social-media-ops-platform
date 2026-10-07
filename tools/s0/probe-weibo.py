#!/usr/bin/env python3
"""Bounded anonymous read probes; no cookies, login, retries or daemon required."""
import argparse
import concurrent.futures
import datetime
import hashlib
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINTS = {
    'hot_band': ('https://weibo.com/ajax/statuses/hot_band', 'band_list'),
    'hotSearch': ('https://weibo.com/ajax/side/hotSearch', 'realtime'),
}


class ProbeError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def failure(result, code):
    result['outcome'] = code
    result['recovery'] = {
        'AUTH_REQUIRED': 'Pause; obtain permitted session or review source route',
        'ACCESS_DENIED': 'Pause; review access conditions; no bypass',
        'RATE_LIMITED': 'Pause; respect Retry-After and configured request budget',
        'SOURCE_CHANGED': 'Pause; review schema before accepting new records',
        'EMPTY_RESULT': 'Mark degraded; do not report healthy or invent items',
    }.get(code, 'Bounded manual recheck; no automatic retries in this probe')


def probe(spec):
    name, (url, list_key) = spec
    started = time.monotonic()
    result = {
        'endpoint': name, 'url': url,
        'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'auth': 'anonymous-no-cookie', 'item_count': 0,
    }
    request = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                      'AppleWebKit/537.36 (KHTML, like Gecko) '
                      'Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://weibo.com/', 'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read(2_000_001)
            result.update(http_status=response.status,
                          content_type=response.headers.get('Content-Type'),
                          server_date=response.headers.get('Date'),
                          cache_age=response.headers.get('Age'),
                          final_url=response.url)
        if len(raw) > 2_000_000:
            raise ProbeError('PARSE_FAILED', 'Response exceeds 2MB probe limit')
        result['response_sha256'] = hashlib.sha256(raw).hexdigest()
        if b'Sina Visitor System' in raw or 'passport.weibo' in result['final_url']:
            raise ProbeError('AUTH_REQUIRED', 'Visitor/login page instead of ranking JSON')
        try:
            data = json.loads(raw)
        except ValueError as error:
            raise ProbeError('PARSE_FAILED', 'Response is not valid JSON') from error
        if not isinstance(data, dict):
            raise ProbeError('SOURCE_CHANGED', 'Expected JSON object')
        result['business_ok'] = data.get('ok')
        payload = data.get('data')
        if data.get('ok') != 1 or not isinstance(payload, dict):
            raise ProbeError('SOURCE_CHANGED', 'Business failure or missing data object')
        items = payload.get(list_key)
        if not isinstance(items, list):
            raise ProbeError('SOURCE_CHANGED', 'Missing or malformed ranking list')
        if not items:
            raise ProbeError('EMPTY_RESULT', 'Ranking list is empty')
        if len(items) > 50:
            raise ProbeError('SOURCE_CHANGED', 'Ranking exceeds expected 50-item limit')
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get('word'), str) or not item['word'].strip():
                raise ProbeError('SOURCE_CHANGED', 'Ranking item is missing a valid title')
            for key in ('realpos', 'num', 'onboard_time'):
                value = item.get(key)
                if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
                    raise ProbeError('SOURCE_CHANGED', 'Unexpected numeric field: ' + key)
            scheme = item.get('word_scheme')
            if scheme is not None and not isinstance(scheme, str):
                raise ProbeError('SOURCE_CHANGED', 'Unexpected word_scheme type')
        result['item_count'] = len(items)
        result['item_keys'] = sorted(set().union(*(x.keys() for x in items if isinstance(x, dict))))
        samples = []
        for item in items[:5]:
            onboard = item.get('onboard_time')
            onboard_iso = None
            if isinstance(onboard, (int, float)) and not isinstance(onboard, bool) and onboard > 0:
                onboard_iso = datetime.datetime.fromtimestamp(onboard, datetime.timezone.utc).isoformat()
            samples.append({
                'title': item['word'], 'rank': item.get('realpos'),
                'hot_value': item.get('num'), 'category': item.get('category'),
                'label': item.get('label_name'),
                'url': 'https://s.weibo.com/weibo?q=' + urllib.parse.quote(item.get('word_scheme') or item['word'], safe=''),
                'onboard_time_raw': onboard, 'onboard_time': onboard_iso,
                'published_at': None,
            })
        result.update(sample=samples, outcome='SUCCESS')
    except urllib.error.HTTPError as error:
        result['http_status'] = error.code
        if error.code == 429:
            result['retry_after'] = error.headers.get('Retry-After') if error.headers else None
        failure(result, {401: 'AUTH_REQUIRED', 403: 'ACCESS_DENIED', 429: 'RATE_LIMITED'}.get(error.code, 'SOURCE_UNAVAILABLE'))
    except ProbeError as error:
        failure(result, error.code)
        result['detail'] = str(error)
    except urllib.error.URLError as error:
        failure(result, 'TIMEOUT' if isinstance(error.reason, (TimeoutError, socket.timeout)) else 'NETWORK_ERROR')
    except (TimeoutError, socket.timeout):
        failure(result, 'TIMEOUT')
    except (OSError, ValueError, TypeError, OverflowError) as error:
        failure(result, 'PARSE_FAILED')
        result['error_type'] = type(error).__name__
    result['elapsed_seconds'] = round(time.monotonic() - started, 3)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', help='Normalized evidence JSON path; no raw response is saved')
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(probe, ENDPOINTS.items()))
    evidence = {'probe_version': 2, 'scope': 'Bounded anonymous availability probe; not API authorization or SLA evidence', 'records': records}
    serialized = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as file:
            file.write(serialized)
    print(serialized)
    return 0 if all(x['outcome'] == 'SUCCESS' for x in records) else 1


if __name__ == '__main__':
    raise SystemExit(main())
