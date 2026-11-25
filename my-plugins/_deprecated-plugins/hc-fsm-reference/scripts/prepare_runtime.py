import argparse
import hashlib
import io
import json
import os
import shutil
import subprocess
import tarfile
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
SOURCES = [
    ('/Users/ssyram/workspace/ai-tools/use-fsm', '216f7aabac78956dbafce45ef4b1edbb65dd0507', 'fsm-src', []),
    ('/Users/ssyram/workspace/ai-tools/mock-with-pi', '9a5a32be920ddeb2700e6b5b9d21d8dc7ebd5590', 'mock-src', ['Cargo.toml', 'Cargo.lock', 'src']),
    ('/Users/ssyram/workspace/ai-tools/haokun-code', 'e81af70d789a33d67a25e158604e9bd6c9325bfd', 'hc-src', ['packages/plugin']),
]


def verified_export(repository, revision, destination, paths):
    data = subprocess.check_output(['git', '-C', repository, 'archive', revision, *paths])
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        if not destination.exists():
            destination.mkdir(parents=True)
            subprocess.run(['/usr/bin/tar', '-xf', '-', '-C', str(destination)], input=data, check=True)
        for member in archive:
            path = destination / member.name
            if member.issym():
                if os.readlink(path) != member.linkname:
                    raise ValueError(f'source symlink differs: {path}')
            elif member.isfile() and path.read_bytes() != archive.extractfile(member).read():
                raise ValueError(f'source differs from pinned git object: {path}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rg', type=Path, help='Existing audited ripgrep 15.1.0 binary; never downloaded by this script')
    args = parser.parse_args()
    RUNTIME.mkdir(exist_ok=True)
    for repository, revision, destination, paths in SOURCES:
        verified_export(repository, revision, RUNTIME / destination, paths)
    cargo_home = RUNTIME / 'cargo-home'
    if not (cargo_home / 'registry').exists():
        cargo_home.mkdir(exist_ok=True)
        print('Cloning public Cargo registry cache into package-owned storage', flush=True)
        subprocess.run(['/bin/cp', '-cR', str(Path.home() / '.cargo/registry'), str(cargo_home / 'registry')], check=True)
    tools = RUNTIME / 'tool-bin'
    tools.mkdir(exist_ok=True)
    expected = json.loads((ROOT / 'docs/versions.json').read_text())
    rg_hash = next(item['sha256'] for item in expected['artifacts'] if item['path'].endswith('/tool-bin/rg'))
    rg = tools / 'rg'
    if not rg.exists():
        if args.rg is None:
            raise ValueError('Missing rg: provide --rg with the audited existing binary; no automatic download is permitted')
        if hashlib.sha256(args.rg.read_bytes()).hexdigest() != rg_hash:
            raise ValueError('provided ripgrep hash differs from audited artifact')
        shutil.copy2(args.rg, rg)
    if hashlib.sha256(rg.read_bytes()).hexdigest() != rg_hash:
        raise ValueError('package ripgrep hash differs from audited artifact')
    run = RUNTIME / 'preparation' / uuid4().hex[:8]
    run.mkdir(parents=True)
    toolchain = Path('/Users/ssyram/.rustup/toolchains/stable-aarch64-apple-darwin/bin')
    for name in ('home', 'tmp'):
        (run / name).mkdir()
    env = {'HOME': str(run / 'home'), 'TMPDIR': str(run / 'tmp'), 'CARGO_HOME': str(cargo_home),
           'PATH': str(toolchain) + ':/usr/bin:/bin:/usr/sbin:/sbin', 'RUSTC': str(toolchain / 'rustc'),
           'RUSTDOC': str(toolchain / 'rustdoc')}
    packages = ['mcp-server-fsm', 'mcp-server-fsm-client', 'mcp-server-fsm-hook']
    commands = []
    if any(not (RUNTIME / 'fsm-src/target/release' / name).exists() for name in packages):
        command = [str(toolchain / 'cargo'), 'build', '--frozen', '--release', '--manifest-path', str(RUNTIME / 'fsm-src/Cargo.toml')]
        for package in packages:
            command.extend(['-p', package])
        commands.append(('fsm', command))
    if not (RUNTIME / 'mock-src/target/release/mock-llm-server').exists():
        commands.append(('mock', [str(toolchain / 'cargo'), 'build', '--frozen', '--release', '--manifest-path', str(RUNTIME / 'mock-src/Cargo.toml')]))
    for label, command in commands:
        print('Building pinned ' + label, flush=True)
        with (run / (label + '.log')).open('x') as log:
            subprocess.run(command, env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, check=True)
    print('Verified pinned source exports and package-owned runtime artifacts; no installation or provider calls')
    print(run)


if __name__ == '__main__':
    main()
