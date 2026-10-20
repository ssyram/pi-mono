import json,pathlib,collections
R=pathlib.Path('/Users/ssyram/workspace/work-fv/c-code-verify/.local/ccv-caller-callee-closure-v1/tests/mocker/run/pi-v3-20261020-182523')
rows=[json.loads(l) for l in (R/'rounds.jsonl').read_text().splitlines()]
end=next((i for i,r in enumerate(rows) if r.get('kind')=='main-after-endpoint'),len(rows))
evidence=[r for r in rows[:end] if r.get('kind')=='v3-evidence']
pairs=sorted(set((r['b'],r.get('label','')) for r in evidence))
print('first-endpoint-event',rows[end].get('at') if end<len(rows) else None)
print('evidence_before_first_endpoint',len(evidence),'distinct_id_label_pairs',len(pairs))
for b,label in pairs:print(b,label)
S=pathlib.Path('/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/fsm-compatible/docs/test-reports/ccv-latency-evidence/rerun-after-fix-summary.json')
s=json.loads(S.read_text());s['first_endpoint_event']=rows[end] if end<len(rows) else None;s['evidence_records_before_first_endpoint']=len(evidence);s['distinct_evidence_id_label_pairs']=[{'id':b,'label':label} for b,label in pairs];S.write_text(json.dumps(s,ensure_ascii=False,indent=2))
