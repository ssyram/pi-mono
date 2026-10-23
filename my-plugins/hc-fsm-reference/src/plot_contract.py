import json
import re
from json_equality import exact_json


def pointer(value, path):
    for part in path.split('/'):
        if part:
            value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def expand(value, bindings):
    if isinstance(value, dict):
        return {key: expand(item, bindings) for key, item in value.items()}
    if isinstance(value, list):
        return [expand(item, bindings) for item in value]
    if not isinstance(value, str):
        return value
    return re.sub(r'\$\{([^}]+)\}', lambda m: str(bindings[m[1]]), value)


def assert_expectations(value, expectations, bindings):
    for rule in expectations:
        actual = pointer(value, rule.get('path', ''))
        if 'equals' in rule:
            expected = expand(rule['equals'], bindings)
            if not exact_json(actual, expected):
                raise ValueError(f'expectation {rule}: got {actual!r}')
        if 'length' in rule and len(actual) != rule['length']:
            raise ValueError(f'length expectation {rule}: got {len(actual)}')
        if 'contains' in rule and expand(rule['contains'], bindings) not in actual:
            raise ValueError(f'expectation {rule}: got {actual!r}')
        if 'regex' in rule and not re.search(rule['regex'], str(actual)):
            raise ValueError(f'expectation {rule}: got {actual!r}')
        if 'bind' in rule:
            match = re.search(rule['regex'], str(actual))
            bound = match.group(rule.get('group', 1))
            key = rule['bind']
            if key in bindings and bindings[key] != bound:
                raise ValueError(f'identity changed: {key}')
            for other, existing in bindings.items():
                if other != key and key.split('.')[0] in ('session', 'part', 'message') and other.split('.')[0] == key.split('.')[0] and existing == bound:
                    raise ValueError(f'identity collision: {key}, {other}')
            bindings[key] = bound


def normalize(value, bindings, rules, binding_names):
    result = json.loads(json.dumps(value))
    for rule in rules:
        parent = result
        parts = rule['path'].strip('/').split('/')
        for part in parts[:-1]:
            parent = parent[int(part)] if isinstance(parent, list) else parent[part]
        key = int(parts[-1]) if isinstance(parent, list) else parts[-1]
        actual = parent[key]
        if rule['kind'] == 'binding':
            if not exact_json(actual, bindings[rule['name']]):
                raise ValueError(f'non-correlated identity: {rule}')
            parent[key] = '${' + rule['name'] + '}'
        elif rule['kind'] == 'timestamp':
            if not isinstance(actual, str) or not re.fullmatch(rule['regex'], actual):
                raise ValueError(f'invalid timestamp: {actual!r}')
            parent[key] = '<timestamp>'
        else:
            raise ValueError(f'unknown normalization rule: {rule}')
    replacements = sorted(((str(bindings[k]), '${' + k + '}') for k in binding_names if k in bindings), key=lambda p: -len(p[0]))
    def walk(item):
        if isinstance(item, str):
            for source, replacement in replacements:
                name = replacement[2:-1]
                if name.split('.')[0] in ('session', 'part', 'message'):
                    item = re.sub(r'(?<![A-Za-z0-9_])' + re.escape(source) + r'(?![A-Za-z0-9_])', lambda _: replacement, item)
                else:
                    item = item.replace(source, replacement)
            return item
        if isinstance(item, list):
            return [walk(child) for child in item]
        if isinstance(item, dict):
            return {key: walk(child) for key, child in item.items()}
        return item
    return walk(result)
