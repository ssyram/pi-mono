import json,pathlib,datetime,collections
B=pathlib.Path('/Users/ssyram/workspace/work-fv/c-code-verify/.local/ccv-caller-callee-closure-v1/tests/mocker/run')
S=pathlib.Path('/Users/ssyram/.pi/agent/sessions')
def ms(t): return datetime.datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()*1000
for run,dirname,rootid in [('pi-v3-20261020-143605','--Users-ssyram-ccv-verify-ccv-pi-143605--','01a15806-565b-7180-b71b-bb906c4ecc93'),('pi-v3-20261020-161635','--Users-ssyram-ccv-verify-ccv-pi-161635--','01a15862-6d54-7078-b808-a92e0b5bbb5b')]:
 steps=[json.loads(l) for l in (B/run/'rounds.jsonl').read_text().splitlines() if json.loads(l).get('kind')=='main-step']
 endstep=steps[-1]['action'];sf=next((S/dirname).glob('*'+rootid+'.jsonl'))
 entries=[json.loads(x) for x in sf.read_text().splitlines()]
 batches=[];current=None
 for entry in entries:
  m=entry.get('message',{});t=ms(entry['timestamp'])
  if m.get('role')=='assistant':
   calls=[c for c in m.get('content',[]) if isinstance(c,dict) and c.get('type')=='toolCall']
   if calls: current={'start':t,'model_ms':m.get('durationMs',0),'calls':calls,'results':[]};batches.append(current)
  if m.get('role')=='toolResult' and current:
   if any(c['id']==m.get('toolCallId') for c in current['calls']): current['results'].append({'end':t,'exec':m.get('durationMs',0),'callid':m.get('toolCallId')})
 # last step emits main_final_sub old or final action latest
 deadline=ms(steps[-1]['at'])+1500
 batches=[b for b in batches if b['start']<=deadline and b['results']]
 out=[];prev=None;tot=collections.defaultdict(float)
 for b in batches:
  end=max(r['end'] for r in b['results']);wall=end-b['start'];execute=sum(r['exec'] or 0 for r in b['results']);gap=(b['start']-prev) if prev else b['model_ms'];prev=end
  pre=wall-execute
  tot['outer_gap']+=gap;tot['prepare_finalize']+=pre;tot['execute']+=execute
  for c in b['calls']:
   r=next((r for r in b['results'] if r['callid']==c['id']),None)
   if not r:continue
   name=c['name'];inp=c.get('arguments',{});desc=inp.get('command',inp.get('filePath',''))
   if name=='bash' and ('v3-worker-ready' in desc or 'store stack' in desc):tot['wait_child_execute']+=r['exec'] or 0
   elif 'try_transition' in name:tot['transition_execute']+=r['exec'] or 0
   else:tot['other_execute']+=r['exec'] or 0
  out.append({'at':datetime.datetime.fromtimestamp(b['start']/1000,datetime.timezone.utc).isoformat(),'tools':[c['name'] for c in b['calls']],'wall_ms':round(wall,2),'execute_ms':execute,'outside_execute_ms':round(pre,2),'model_or_interbatch_ms':round(gap,2)})
 print(run,'last-action',endstep,'batches',len(batches),'totals_ms',dict(tot))
 pathlib.Path('/tmp/'+run+'-account.json').write_text(json.dumps({'run':run,'totals_ms':dict(tot),'batches':out},ensure_ascii=False,indent=2))
# compare get_state/user creation boot child vs main agent result
for dirname in ['--Users-ssyram-ccv-verify-ccv-pi-143605--','--Users-ssyram-ccv-verify-ccv-pi-161635--']:
 for sf in sorted((S/dirname).glob('*.jsonl')):
  es=[json.loads(x) for x in sf.read_text().splitlines()];u=next((e for e in es if e.get('message',{}).get('role')=='user'),None);a=next((e for e in es if e.get('message',{}).get('role')=='assistant'),None)
  print('boot',es[0]['id'],'session',es[0]['timestamp'],'user',u['timestamp'] if u else None,'first_assistant',a['timestamp'] if a else None)
