import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const wrapper = fileURLToPath(new URL("./profile-boundary.py", import.meta.url));

test("profile-boundary projects only declared receipt profile and hc_agent assertion", async () => {
	const directory = await mkdtemp(join(tmpdir(), "profile-boundary-"));
	try {
		await mkdir(join(directory, "src"));
		await mkdir(join(directory, "bin"));
		await writeFile(join(directory, "src/json_equality.py"), `def exact_json(left, right):
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(exact_json(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(exact_json(a, b) for a, b in zip(left, right))
    return left == right
`);
		await writeFile(join(directory, "src/hc_tool_observation.py"), `def hc_tool_result(run, actor, index, step, plot, bindings):
    assert 'hc_agent' not in step
    assert step['other'] == 'retained'
    return {'agent': None, 'model': {'providerID': 'actual', 'modelID': 'actual-model'}}
`);
		await writeFile(join(directory, "src/plot_engine.py"), "from json_equality import exact_json\nfrom hc_tool_observation import hc_tool_result\n");
		await writeFile(join(directory, "bin/use-plot"), `import copy
import json
import plot_engine
result = plot_engine.hc_tool_result(None, 'subject', 3, {'hc_agent': 'general', 'other': 'retained'}, {}, {})
actual = {'toolCallId': 'plot_subject_003', 'observation': {'hc_result': result}, 'business': True}
golden = copy.deepcopy(actual)
golden['observation']['hc_result']['agent'] = 'general'
profile_pass = plot_engine.exact_json(actual, golden)
wrong_model = copy.deepcopy(golden)
wrong_model['observation']['hc_result']['model']['modelID'] = 'wrong'
wrong_type = copy.deepcopy(golden)
wrong_type['business'] = 1
present_profile = copy.deepcopy(actual)
present_profile['observation']['hc_result']['agent'] = 'unexpected'
print(json.dumps({'profile_pass': profile_pass,
    'model_strict': not plot_engine.exact_json(actual, wrong_model),
    'types_strict': not plot_engine.exact_json(actual, wrong_type),
    'present_profile_strict': not plot_engine.exact_json(present_profile, golden),
    'unrelated_agent_strict': not plot_engine.exact_json({'agent': None}, {'agent': 'general'})}))
`);
		const result = spawnSync("python3", [wrapper, directory, "unused-plot"], {
			env: { ...process.env, PLOT_RUN: directory }, encoding: "utf8",
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(JSON.parse(result.stdout), { profile_pass: true, model_strict: true,
			types_strict: true, present_profile_strict: true, unrelated_agent_strict: true });
		const boundaries = (await readFile(join(directory, "profile-boundaries.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
		assert.equal(boundaries.length, 4);
		assert.deepEqual(boundaries[0], { point: "hc_agent assertion", callID: "plot_subject_003", golden: "general", pi: null });
		assert.ok(boundaries.slice(1).every((entry) => entry.point === "hc_result.agent equality"
			&& entry.callID === "plot_subject_003" && entry.golden === "general" && entry.pi === null));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
