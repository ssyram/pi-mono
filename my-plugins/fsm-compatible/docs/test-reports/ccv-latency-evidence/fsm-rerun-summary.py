import json,pathlib,datetime,sqlite3,hashlib
R=pathlib.Path('/Users/ssyram/workspace/work-fv/c-code-verify/.local/ccv-caller-callee-closure-v1/tests/mocker/run/pi-v3-20261020-182523')
OUT=pathlib.Path('/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/fsm-compatible/docs/test-reports/ccv-latency-evidence')
def dt(t):return datetime.datetime.fromisoformat(t.replace('Z','+00:00'))
rows=[json.loads(l) for l in (R/'rounds.jsonl').read_text().splitlines()]
steps=[r for r in rows if r.get('kind')=='main-step']
errors=[r for r in rows if r.get('kind') in ('error','scenario-failed','scenario-crashed')]
evidence=[r for r in rows if r.get('kind')=='v3-evidence']
status=json.loads((R/'status.json').read_text());endpoint=dt(status['endpoint_at']).timestamp()*1000
cfiles=list((R/'captures').glob('req-*.json'));requests_before_endpoint=0
for f in cfiles:
 d=json.loads(f.read_text())
 if d.get('receivedAt',0)<=endpoint:requests_before_endpoint+=1
memo=json.loads((R/'memo.json').read_text());root=memo.get('root')
con=sqlite3.connect('file:/Users/ssyram/workspace/work-fv/c-code-verify/.local/fsm-pi-v3-20261020-182523/d/store.db?mode=ro',uri=True)
trans=[{'at':t,'actor':a,'event':e,'detail':json.loads(c)} for t,a,e,c in con.execute("select timestamp,agent_id,emit,content from history where emit like 'transition.%' order by id")]
sessions=pathlib.Path('/Users/ssyram/.pi/agent/sessions/--Users-ssyram-ccv-verify-ccv-pi-182523--')
per_session=[]
for f in sessions.glob('*.jsonl'):
 entries=[json.loads(l) for l in f.read_text().splitlines()];sid=entries[0]['id'];batches=[];b=None
 for e in entries:
  m=e.get('message',{});t=dt(e['timestamp']).timestamp()*1000
  if t>endpoint+1500:continue
  if m.get('role')=='assistant':
   calls=[c for c in m.get('content',[]) if isinstance(c,dict) and c.get('type')=='toolCall']
   if calls:b={'start':t,'calls':calls,'results':[]};batches.append(b)
  elif m.get('role')=='toolResult' and b and any(c['id']==m.get('toolCallId') for c in b['calls']):b['results'].append({'end':t,'exec':m.get('durationMs',0),'call':m.get('toolCallId')})
 parsed=[];totals={'prepare_finalize_ms':0,'transition_execute_ms':0,'child_wait_execute_ms':0,'other_execute_ms':0}
 for b in batches:
  if not b['results']:continue
  wall=max(r['end'] for r in b['results'])-b['start'];exe=sum(r['exec'] or 0 for r in b['results']);totals['prepare_finalize_ms']+=wall-exe
  for c in b['calls']:
   r=next((r for r in b['results'] if r['call']==c['id']),None)
   if r is None:continue
   cmd=c.get('arguments',{}).get('command','')
   bucket='transition_execute_ms' if 'try_transition' in c['name'] else 'child_wait_execute_ms' if c['name']=='bash' and ('v3-worker-ready' in cmd or 'store stack' in cmd) else 'other_execute_ms'
   totals[bucket]+=r['exec'] or 0
  parsed.append({'at':datetime.datetime.fromtimestamp(b['start']/1000,datetime.timezone.utc).isoformat(),'tools':[c['name'] for c in b['calls']],'wall_ms':round(wall,2),'execute_ms':exe,'prepare_finalize_ms':round(wall-exe,2)})
 firstuser=next((e['timestamp'] for e in entries if e.get('message',{}).get('role')=='user'),None)
 firstassistant=next((e['timestamp'] for e in entries if e.get('message',{}).get('role')=='assistant'),None)
 per_session.append({'session_id':sid,'is_root':sid==root,'created':entries[0]['timestamp'],'first_user':firstuser,'first_assistant':firstassistant,'totals':totals,'batches':parsed})
summary={'run':R.name,'status':status,'root_session_id':root,'main_step_count':len(steps),'main_first':steps[0]['at'],'main_last':steps[-1]['at'],'main_elapsed_seconds':(dt(steps[-1]['at'])-dt(steps[0]['at'])).total_seconds(),'error_count':len(errors),'evidence_records':len(evidence),'evidence_ids':sorted(set(r['b'] for r in evidence)),'requests_total':len(cfiles),'requests_received_before_endpoint':requests_before_endpoint,'transitions':trans,'sessions':per_session}
(OUT/'rerun-after-fix-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ('sessions','transitions')},ensure_ascii=False,indent=2))
for s in per_session:print('session',s['session_id'],'root',s['is_root'],s['totals'])
for t in trans:print('transition',t['actor'],t['event'],t['detail'].get('result'),t['detail'].get('from'),t['detail'].get('to'))
