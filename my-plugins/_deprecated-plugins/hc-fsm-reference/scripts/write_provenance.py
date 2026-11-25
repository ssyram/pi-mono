import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    ('fsm', '/Users/ssyram/workspace/ai-tools/use-fsm', '216f7aabac78956dbafce45ef4b1edbb65dd0507', '.runtime/fsm-src', []),
    ('mock', '/Users/ssyram/workspace/ai-tools/mock-with-pi', '9a5a32be920ddeb2700e6b5b9d21d8dc7ebd5590', '.runtime/mock-src', ['Cargo.toml', 'Cargo.lock', 'src']),
    ('hc-plugin-source', '/Users/ssyram/workspace/ai-tools/haokun-code', 'e81af70d789a33d67a25e158604e9bd6c9325bfd', '.runtime/hc-src', ['packages/plugin']),
]


def command(*args):
    return subprocess.check_output(args)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify_tree(repository, revision, destination, paths):
    listing = command('git', '-C', repository, 'ls-tree', '-rz', '--full-tree', revision, *paths)
    entries = []
    for line in listing.split(b'\0'):
        if not line:
            continue
        header, name = line.split(b'\t', 1)
        mode, kind, object_id = header.decode().split()
        if kind != 'blob':
            raise ValueError('source export unexpectedly contains a submodule')
        entries.append((mode, object_id, name.decode()))
    request = ''.join(object_id + '\n' for _, object_id, _ in entries).encode()
    result = subprocess.run(['git', '-C', repository, 'cat-file', '--batch'], input=request, capture_output=True, check=True).stdout
    offset = 0
    manifest = []
    for mode, object_id, name in entries:
        end = result.index(b'\n', offset)
        header = result[offset:end].decode().split()
        if header[:2] != [object_id, 'blob']:
            raise ValueError('unexpected git batch response')
        size = int(header[2])
        original = result[end + 1:end + 1 + size]
        offset = end + size + 2
        path = destination / name
        actual = os.readlink(path).encode() if mode == '120000' else path.read_bytes()
        if actual != original:
            raise ValueError(f'export differs from pinned source: {name}')
        manifest.append({'path': name, 'gitBlob': object_id, 'sha256': sha(actual)})
    return manifest


sources = []
for name, repository, revision, destination, paths in SOURCES:
    files = verify_tree(repository, revision, ROOT / destination, paths)
    sources.append({'name': name, 'repository': repository, 'commit': revision,
                    'gitTree': command('git', '-C', repository, 'rev-parse', revision + '^{tree}').decode().strip(),
                    'archiveSha256': sha(command('git', '-C', repository, 'archive', revision, *paths)), 'verifiedFiles': files})
files = [ROOT / '.runtime/fsm-src/target/release' / name for name in ('mcp-server-fsm', 'mcp-server-fsm-client', 'mcp-server-fsm-hook')]
files += [ROOT / '.runtime/mock-src/target/release/mock-llm-server', Path('/Users/ssyram/bin/opencode'), ROOT / '.runtime/tool-bin/rg']
versions = {'sources': sources, 'artifacts': [{'path': str(path), 'resolvedPath': str(path.resolve()), 'sha256': sha(path.read_bytes())} for path in files],
    'hcVersion': command('/Users/ssyram/bin/opencode', '--version').decode().strip(),
    'hcTagCommit': command('git', '-C', '/Users/ssyram/workspace/ai-tools/haokun-code', 'rev-list', '-n', '1', 'v1.18.31-fmv2.1').decode().strip(),
    'python': {'version': sys.version, 'executable': sys.executable}, 'platform': platform.platform(),
    'cargo': command('/Users/ssyram/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo', '--version').decode().strip(),
    'rustc': command('/Users/ssyram/.rustup/toolchains/stable-aarch64-apple-darwin/bin/rustc', '--version').decode().strip(),
    'ripgrep': command(str(ROOT / '.runtime/tool-bin/rg'), '--version').decode().strip(),
    'notes': ['HC is the supplied prebuilt release, not rebuilt here.', 'FSM/mock production exports verified byte-for-byte against pinned git blobs.',
              'ripgrep came from HC diagnostic bootstrap of its pinned 15.1.0 release; no source-build attestation for ripgrep.',
              'FSM uses the public development wrapping-secret placeholder; experiments are plaintext isolated test stores.']}
path = ROOT / 'docs/versions.json'
if path.exists():
    json.loads(path.read_text())
path.write_text(json.dumps(versions, ensure_ascii=False, indent=2) + '\n')
print(path)
