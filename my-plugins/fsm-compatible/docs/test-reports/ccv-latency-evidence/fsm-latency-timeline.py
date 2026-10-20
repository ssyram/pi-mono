import json, pathlib, datetime, collections, statistics
base=pathlib.Path('/Users/ssyram/.pi/agent/sessions/--Users-ssyram-ccv-verify-ccv-pi-143605--')
root=pathlib.Path('/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/fsm-compatible')
rows=[]
for f in sorted(base.glob('*.jsonl')):
    entries=[json.loads(x) for x in f.read_text().splitlines()]
    sid=entries[0]['id']; calls={}; prev=None
    for entry in entries:
        m=entry.get('message',{}); ts=entry.get('timestamp')
        if not ts: continue
        t=datetime.datetime.fromisoformat(ts.replace('Z','+00:00')).timestamp()*1000
        if m.get('role')=='assistant':
            batch=[b for b in m.get('content',[]) if isinstance(b,dict) and b.get('type')=='toolCall']
            if batch:
                for b in batch: calls[b['id']]={'name':b['name'],'input':b.get('arguments',{}),'assistant_ms':t,'batch':len(batch)}
        elif m.get('role')=='toolResult':
            c=calls.get(m.get('toolCallId'))
            if not c: continue
            rec={'sid':sid,'role':'main' if sid=='01a15806-565b-7180-b71b-bb906c4ecc93' else 'child','name':c['name'],'call':m['toolCallId'],'result_at':ts,'duration_ms':m.get('durationMs'),'wall_ms':round(t-c['assistant_ms'],1),'input':c['input']}
            rows.append(rec)
            if c['batch']==1:
                rec['unaccounted_ms']=round(rec['wall_ms']-(rec['duration_ms'] or 0),1)
print('MAIN tools before last main-step:')
cut=datetime.datetime.fromisoformat('2026-10-20T06:40:22+00:00').timestamp()*1000
for r in rows:
    if r['role']=='main' and datetime.datetime.fromisoformat(r['result_at'].replace('Z','+00:00')).timestamp()*1000<=cut+500:
        print(r['result_at'][11:23],r['name'],r['call'],'wall',r['wall_ms'],'execute',r['duration_ms'],'unaccounted',r.get('unaccounted_ms','batch'))
print('CHILD tools:')
for r in rows:
    if r['role']=='child': print(r['result_at'][11:23],r['name'],r['call'],'wall',r['wall_ms'],'execute',r['duration_ms'],'unaccounted',r.get('unaccounted_ms','batch'))
pathlib.Path('/tmp/fsm-latency-tool-timeline.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
