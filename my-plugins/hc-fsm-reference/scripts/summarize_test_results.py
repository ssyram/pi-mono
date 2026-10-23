import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
log_path = ROOT / '.runtime/upstream-tests/c527a9b8/fsm-upstream.log'
text = log_path.read_text()
rows = re.findall(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored', text)
failed = re.findall(r'^---- (.+) stdout ----$', text, re.MULTILINE)
framework = ROOT / '.runtime/framework-tests-v2-final.log'
plugin = ROOT / '.runtime/plugin-tests/3b7cd716/output.log'
if 'Ran 27 tests' not in framework.read_text() or not framework.read_text().rstrip().endswith('OK'):
    raise ValueError('framework evidence is not the expected passing run')
if '101 pass' not in plugin.read_text() or '0 fail' not in plugin.read_text():
    raise ValueError('plugin evidence is not the expected passing run')
result = {
    'framework': {'passed': 27, 'failed': 0, 'log': str(framework.relative_to(ROOT)),
                  'realHcMismatch': 'runs/c0251d48c', 'expectedFaultExit': 1, 'followingWriteNeverExecuted': True, 'jsonTypeRegressionFirstFailure': '.runtime/json-types-first-failure.log', 'jsonTypeAndUnchangedActionChecksPassed': 7},
    'pinnedFsmRust': {'passedExecutions': sum(int(row[1]) for row in rows), 'failedExecutions': sum(int(row[2]) for row in rows),
        'ignoredExecutions': sum(int(row[3]) for row in rows), 'failedTests': failed, 'log': str(log_path.relative_to(ROOT)),
        'result': 'failed', 'classification': 'macOS AF_UNIX SUN_LEN exceeded by package-owned temporary paths',
        'daemonFailureProof': '.t/mfs-bs75065-3/.mcp_server_fsm/logs/server.log',
        'notes': 'Counts are executions across lib/bin/integration targets, not unique tests or full feature proofs; no source/test patches.'},
    'pinnedFsmPluginBun': {'passed': 101, 'failed': 0, 'log': str(plugin.relative_to(ROOT)), 'bun': '1.4.2'},
    'notExecuted': ['installer pytest suites', 'TUI renderer/snapshot suites', 'real-provider full-e2e legs', 'peer-contract experiments',
                    'eval/SWE-bench tasks', 'standalone SQLCipher spike', 'Python demo harnesses'],
}
path = ROOT / 'evidence/test-results-v2.json'
if path.exists():
    if json.loads(path.read_text()) != result:
        raise ValueError('existing test evidence differs')
else:
    with path.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
print(json.dumps(result, ensure_ascii=False, indent=2))
