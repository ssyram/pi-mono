import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
const dir=await mkdtemp(join(tmpdir(),'fsm-latency-'));
await writeFile(join(dir,'auth.token'),'local-test-token');
let started=0;
const server=createServer((req,res)=>{req.resume();req.on('end',()=>{
 console.log(JSON.stringify({event:'server-response',path:req.url,elapsed_ms:performance.now()-started}));
 res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,allowed:true}));
});});
await new Promise(r=>server.listen(join(dir,'server.sock'),r));
const helper='/Users/ssyram/workspace/ai-tools/pi-mono/my-plugins/fsm-compatible/src/broker/daemon-request.mjs';
for(let i=0;i<3;i++){
 started=performance.now();
 const p=spawn(process.execPath,[helper],{stdio:['pipe','pipe','pipe']});
 p.stdout.on('data',()=>console.log(JSON.stringify({event:'stdout',elapsed_ms:performance.now()-started})));
 p.stderr.resume();
 p.stdin.end(JSON.stringify({dataDir:dir,path:'/check-permission',method:'POST',body:{},identity:{session_id:'probe',agent_id:'main'},deadline:Date.now()+15000}));
 await new Promise(r=>p.on('close',code=>{console.log(JSON.stringify({event:'close',code,elapsed_ms:performance.now()-started}));r();}));
}
await new Promise(r=>server.close(r));await rm(dir,{recursive:true});
