import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
const dir=await mkdtemp(join(tmpdir(),'fsm-real-latency-'));
const binary='/Users/ssyram/workspace/work-fv/c-code-verify/.local/fsm-runtime-caller-callee-closure-v1/oi/bin/mcp-server-fsm';
const helper='/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/fsm-compatible/src/broker/daemon-request.mjs';
const daemon=spawn(binary,['serve','--data-dir',dir],{env:{...process.env,FSM_DATA_DIR:dir},stdio:'ignore'});
let token;
async function http(path,method='GET',body){
 return new Promise((resolve,reject)=>{
  const q=request({socketPath:join(dir,'server.sock'),path,method,agent:false,headers:{'x-fsm-auth':token,'content-type':'application/json'}},r=>{const a=[];r.on('data',x=>a.push(x));r.on('end',()=>resolve({status:r.statusCode,body:JSON.parse(Buffer.concat(a).toString())}));});
  q.on('error',reject);q.end(body===undefined?undefined:JSON.stringify(body));
 });
}
async function viaHelper(name,identity){
 const t=performance.now();let stdout='';
 const p=spawn(process.execPath,[helper],{stdio:['pipe','pipe','pipe']});p.stdout.on('data',x=>stdout+=x);p.stderr.resume();
 const body={session_id:'latency-probe',agent_id:'main',tool_name:name,tool_input:{file_path:'/tmp/probe',command:'true'}};
 p.stdin.end(JSON.stringify({dataDir:dir,method:'POST',path:'/check-permission',body,deadline:Date.now()+20000,...(identity?{identity:{session_id:body.session_id,agent_id:body.agent_id,tool_name:name,agent_cli:'opencode'}}:{})}));
 await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error('helper failed')));});
 const v=JSON.parse(stdout);console.log(JSON.stringify({test:'helper',name,identity,elapsed_ms:+(performance.now()-t).toFixed(2),status:v.status,allowed:v.body.allowed}));
}
try{
 for(let i=0;i<100;i++){
  try{token=(await readFile(join(dir,'auth.token'),'utf8')).trim();if((await http('/health')).status===200)break;}catch{}
  await new Promise(r=>setTimeout(r,50));
 }
 console.log(JSON.stringify({test:'runtime',node:process.version,binary}));
 for(const name of ['Read','Read','Write','Write','Write'])await viaHelper(name,true);
 for(let i=0;i<3;i++)await viaHelper('Read',false);
 const t=performance.now();
 for(let i=0;i<3;i++)await http('/check-permission','POST',{session_id:'latency-probe',agent_id:'main',tool_name:'Read',tool_input:{file_path:'/tmp/probe'}});
 console.log(JSON.stringify({test:'direct-no-identity',calls:3,total_ms:+(performance.now()-t).toFixed(2)}));
}finally{
 daemon.kill('SIGTERM');await new Promise(r=>daemon.once('close',r));await rm(dir,{recursive:true});
}
