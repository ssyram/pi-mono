#!/usr/bin/env python3
"""Load an unchanged private copy of the upstream v3 script with isolated runtime paths."""
import json
import os
import sys
from pathlib import Path

context = json.loads((Path(os.environ["FSM_TEST_WORKSPACE"]).parent / "ccv-v3-context.json").read_text())
os.environ.update(context["env"])
sys.path.insert(0, context["library"])
import scenario_ext_v3

scenario_ext_v3.main()
