import json
import os
from pathlib import Path


def freeze(path, baseline, run_id):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    candidates = path.parent / 'candidates'
    candidates.mkdir(exist_ok=True)
    candidate = candidates / (run_id + '.json')
    with candidate.open('x') as output:
        json.dump(baseline, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(candidate, 0o444)
    os.link(candidate, path)


def verify_inputs(golden, manifest):
    for key in ('plotHash', 'behaviorHashes', 'binaries'):
        if golden[key] != manifest[key]:
            raise ValueError(f'replay input changed: {key}')
