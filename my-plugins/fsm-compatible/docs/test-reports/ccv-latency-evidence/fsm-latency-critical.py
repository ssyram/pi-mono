import json,pathlib,datetime
D=pathlib.Path('/Users/ssyram/.pi/agent/sessions/--Users-ssyram-ccv-verify-ccv-pi-143605--')
def ms(t):return datetime.datetime.fromisoformat(t.replace('Z','+00:00')).timestamp()*1000
def batches(sf):
 out=[];b=None
 for e in map(json.loads,sf.read_text().splitlines()):
  m=e.get('message',{});t=ms(e['timestamp'])
  if m.get('role')=='assistant':
   calls=[c for c in m.get('content',[]) if isinstance(c,dict) and c.get('type')=='toolCall']
   if calls:b={'start':t,'calls':calls,'results':[]};out.append(b)
  if m.get('role')=='toolResult' and b and any(c['id']==m.get('toolCallId') for c in b['calls']):b['results'].append({'end':t,'exec':m.get('durationMs',0),'id':m['toolCallId']})
 return [b for b in out if b['results']]
main=batches(next(D.glob('*01a15806-565b-7180-b71b-bb906c4ecc93.jsonl')))
child=batches(next(D.glob('*01a15808-a4c3-77f9-a04b-694ffe4ee201.jsonl')))
wait=[]
for b in main:
 for c in b['calls']:
  cmd=c.get('arguments',{}).get('command','')
  if c['name']=='bash' and ('v3-worker-ready' in cmd or 'store stack' in cmd):
   r=next(r for r in b['results'] if r['id']==c['id']);wait.append((r['end']-r['exec'],r['end']))
segments=[]
for b in child:
 end=max(r['end'] for r in b['results']);prep_end=end-sum(r['exec'] or 0 for r in b['results'])
 for i,(ws,we) in enumerate(wait):
  overlap=max(0,min(we,prep_end)-max(ws,b['start']))
  if overlap>1:segments.append({'wait':i+1,'tool':','.join(c['name'] for c in b['calls']),'overlap_ms':overlap})
print('overlap_child_preparation_with_main_wait_execute',segments)
print('child_preparation_blocking_main_ms',sum(s['overlap_ms'] for s in segments))
print('wait_execute_total_ms',sum(b-a for a,b in wait))
pathlib.Path('/tmp/fsm-latency-critical.json').write_text(json.dumps({'child_preparation_wait_intersections':segments,'total_ms':sum(s['overlap_ms'] for s in segments)},indent=2))
