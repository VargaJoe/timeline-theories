import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createClient } from './m1-client.mjs';
const require=createRequire(import.meta.url), local=require('./m0-local-api.cjs');
const PROJECT='/Root/Content/timelines', REPORT=path.join(local.ROOT,'m1-concurrency-report.json');
const SCOPES=['content:read','media:write'];
const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error(label)),ms);timer.unref();})]);

/** Only these two explicitly spawned worker processes are controlled by the harness. */
async function worker(port,dataDir) {
  assert.ok([8082,8083].includes(port));
  const absolute=path.resolve(dataDir);assert.ok(absolute.startsWith(path.resolve(local.ROOT)+path.sep+'m1-concurrency-'));
  const {Coordinator}=await import('../server/coordinator.mjs');
  const originalRun=Coordinator.prototype.run;let arm=false, release;
  Coordinator.prototype.run=function(action){return originalRun.call(this,async()=>{
    if(arm){arm=false;process.send?.({type:'lockHeld',pid:process.pid});await new Promise(resolve=>{release=resolve;});release=undefined;}
    return action();
  });};
  const {loadConfig}=await import('../server/config.mjs'),{createApp}=await import('../server/app.mjs');
  const app=createApp({...loadConfig({local:true}),port,dataDir:absolute});
  process.on('message',message=>{if(message?.type==='arm'){arm=true;process.send?.({type:'armed'});}if(message?.type==='release')release?.();if(message?.type==='stop'){release?.();app.server.close(()=>{app.coordinator?.close();app.store.close();process.exit(0);});}});
  await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(port,'127.0.0.1',resolve);});
  process.send?.({type:'ready',pid:process.pid,port});
}
function waitMessage(child,type){return timeout(new Promise((resolve,reject)=>{
  const onMessage=message=>{if(message?.type==='failed'){cleanup();reject(new Error('Owned worker startup failed'));}else if(message?.type===type){cleanup();resolve(message);}},onExit=()=>{cleanup();reject(new Error('Owned worker exited before '+type));};
  const cleanup=()=>{child.off('message',onMessage);child.off('exit',onExit);};child.on('message',onMessage);child.on('exit',onExit);
}),20000,'Owned worker did not reach '+type);}
async function start(port,dataDir){const child=fork(fileURLToPath(import.meta.url),['--worker','--port',String(port),'--data-dir',dataDir],{cwd:path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});try{await waitMessage(child,'ready');return child;}catch(error){await stop(child);throw error;}}
async function stop(child){if(!child||child.exitCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));if(child.connected)child.send({type:'stop'});else child.kill();try{await timeout(exited,5000,'Owned worker stop timeout');}catch{child.kill();await timeout(exited,5000,'Owned worker did not terminate');}}
function createLocalClient(port){assert.ok([8082,8083].includes(port));return createClient({baseUrl:'https://localhost:'+port+'/api/v1',repository:local.REPOSITORY,authority:local.AUTHORITY,project:PROJECT,caFile:path.join(local.ROOT,'certificates/localhost.pem')});}
async function count(){const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:'+InTree:'+PROJECT+' .AUTOFILTERS:OFF .LIFESPAN:OFF','$top':'0','$inlinecount':'allpages',metadata:'no'}),{account:local.readAccounts().admin});assert.equal(response.status,200);const value=Number(response.value.d.__count);assert.ok(Number.isSafeInteger(value));return value;}

/** Two real API processes and real stock-repository requests share one durable writer database. */
export async function run() {
  const prefix='m1-concurrency-'+randomUUID(),dataDir=path.join(local.ROOT,prefix),owned=new Map(),checks=[];
  const report={version:1,architecture:'standard-sensenet-shared-application-coordinator',ranAt:new Date().toISOString(),repository:local.REPOSITORY,project:PROJECT,fixturePrefix:prefix,dataDirectory:path.basename(dataDir),checks,cleanup:[],passed:false,scope:'Two independent gateway processes sharing this dataDir. No claim about direct raw repository admin writers or another coordinator deployment.',instrumentation:'Worker A pauses one coordinator callback after real BEGIN IMMEDIATE. A separate SQLite connection verifies the actual busy lock; Worker B remains pending until release. Server source is not modified.'};
  fs.writeFileSync(REPORT,JSON.stringify(report,null,2));let a,b,grant,failure,initialCount,reservedCreate;
  const record=(name,detail={})=>{checks.push({name,...detail,passed:true});console.log(JSON.stringify(checks.at(-1)));};
  const ca=createLocalClient(8082),cb=createLocalClient(8083);
  const read=async(client,id)=>(await client.request('/content/'+id,{token:grant.token})).data;
  const preview=async(client,commands)=>{const plan=await client.request('/plans',{method:'POST',token:grant.token,body:{commands}});assert.equal(plan.repositoryWrites,0);return plan;};
  const apply=(client,plan,key=randomUUID())=>client.request('/plans/'+plan.id+'/apply',{method:'POST',token:grant.token,body:{},idempotencyKey:key});
  const remember=content=>{assert.ok(content.Name.startsWith(prefix)&&content.Path.startsWith(PROJECT+'/MediaLibrary/'));owned.set(content.Id,{id:content.Id,name:content.Name,path:content.Path});return content;};
  try {
    initialCount=await count();report.initialCount=initialCount;
    a=await start(8082,dataDir);b=await start(8083,dataDir);assert.notEqual(a.pid,b.pid);report.processes=[{port:8082,pid:a.pid},{port:8083,pid:b.pid}];await ca.verify();await cb.verify();
    grant=await ca.request('/grants',{method:'POST',token:local.readAccounts().editor.apiKey,backendAuth:'ApiKey',body:{scopes:SCOPES,expiresInSeconds:3600}});
    reservedCreate={name:prefix+'-same-key',path:PROJECT+'/MediaLibrary/'+prefix+'-same-key'};
    const createPlan=await preview(ca,[{action:'create',type:'MediaItem',fields:{Name:reservedCreate.name,DisplayName:'Independent gateway concurrency fixture',Title:'Owned concurrency fixture',MediaType:'movie',Description:'Before coordinated race'}}]);
    const key=randomUUID();report.reservedCreate={...reservedCreate,planId:createPlan.id,idempotencyKey:key};
    const creates=await Promise.all([apply(ca,createPlan,key),apply(cb,createPlan,key)]);
    assert.deepEqual(creates[0],creates[1]);const id=creates[0].completed[0].result.id;assert.ok(Number.isSafeInteger(id));const content=remember(await read(ca,id));assert.equal(await count(),initialCount+1);
    assert.ok(typeof content.revision==='string'&&content.revision.length>0&&content.revision.length<=200);
    record('Same saved create plan/key applied through two independent gateways creates exactly one content ID',{processes:2,ownedContents:1});
    const pa=await preview(ca,[{action:'update',targetId:id,expectedRevision:content.revision,fields:{Description:'Worker A coordinated edit'}}]);
    const pb=await preview(cb,[{action:'update',targetId:id,expectedRevision:content.revision,fields:{Description:'Worker B stale edit must not overwrite'}}]);
    const armed=waitMessage(a,'armed');a.send({type:'arm'});await armed;
    const updateKey=randomUUID(),held=waitMessage(a,'lockHeld'),first=apply(ca,pa,updateKey).then(value=>({value}),error=>({error}));await held;
    const db=new DatabaseSync(path.join(dataDir,'coordination.sqlite'));let acquired=false;
    try{db.exec('PRAGMA busy_timeout=0');try{db.exec('BEGIN IMMEDIATE');acquired=true;db.exec('ROLLBACK');}catch(error){assert.ok(/locked|busy/i.test(error.message));}}finally{db.close();}
    assert.equal(acquired,false,'The application process did not hold the shared SQLite writer lock');
    let settled=false;const second=apply(cb,pb).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
    await new Promise(resolve=>setTimeout(resolve,350));assert.equal(settled,false,'The second independent writer bypassed the held database lock');
    const unchanged=await local.api(id,{account:local.readAccounts().editor,query:{'$select':'Description',metadata:'no'}});
    assert.equal(unchanged.Description,'Before coordinated race');record('Actual SQLite lock blocks the other gateway and a direct stock read confirms no premature write',{blockedWriterPort:8083});
    a.send({type:'release'});const winner=await first;if(winner.error)throw winner.error;assert.equal(winner.value.ok,true);const loser=await second;assert.equal(loser.error?.status,409);assert.equal(loser.error?.code,'revision_conflict');
    const current=await read(cb,id);assert.equal(current.Description,'Worker A coordinated edit');assert.notEqual(current.revision,content.revision);
    const replay=await apply(cb,pa,updateKey);assert.equal(replay.ok,true);assert.equal((await read(ca,id)).revision,current.revision);
    record('After release one coordinated edit succeeds and the competing saved revision fails across processes',{winnerPort:8082,stalePort:8083,status:409});
    record('Opaque revision changed once and a committed operation receipt replays from the other process without another save');
  }catch(error){failure=error;report.error={status:error.status??null,code:error.code||'concurrency_assertion_or_transport_failure'};console.error(JSON.stringify({failure:report.error}));}
  finally {
    if(a?.connected)a.send({type:'release'});
    if(grant&&reservedCreate&&!owned.size&&a?.connected){
      try{const found=(await ca.request('/lookup',{method:'POST',token:grant.token,body:{target:reservedCreate.path}})).data;assert.equal(found.Name,reservedCreate.name);assert.equal(found.Path,reservedCreate.path);assert.equal(found.Type,'MediaItem');remember(found);}
      catch(error){if(error.status!==404){failure||=error;report.cleanup.push({path:reservedCreate.path,deleted:false,code:error.code||'ownership_recovery_failed'});}}
    }
    for(const fixture of owned.values()) {
      try{const current=await read(ca,fixture.id);assert.equal(current.Name,fixture.name);assert.equal(current.Path,fixture.path);const plan=await preview(ca,[{action:'delete',targetId:fixture.id,expectedRevision:current.revision}]);await apply(ca,plan);let absent=false;try{await read(cb,fixture.id);}catch(error){absent=error.status===404;}assert.equal(absent,true);report.cleanup.push({id:fixture.id,deleted:true,via:'native'});}
      catch(error){failure||=error;report.cleanup.push({id:fixture.id,deleted:false,code:error.code||'cleanup_failure'});}
    }
    if(grant){try{await ca.request('/grants/'+grant.id+'/revoke',{method:'POST',token:grant.token,body:{}});}catch(error){failure||=error;}}
    try{report.finalCount=await count();assert.equal(report.finalCount,initialCount);}catch(error){failure||=error;}
    for(const child of [b,a]){try{await stop(child);}catch(error){failure||=error;report.processStopFailed=true;}}
    report.passed=!failure;fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({passed:report.passed,checks:checks.length,independentProcesses:report.processes?.length??0,cleaned:report.cleanup.filter(item=>item.deleted).length,initialCount,finalCount:report.finalCount,report:REPORT}));
  if(failure)throw new Error('Shared-coordinator concurrency acceptance failed; inspect sanitized report');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const args=process.argv.slice(2);if(args[0]==='--worker'){worker(Number(args[args.indexOf('--port')+1]),args[args.indexOf('--data-dir')+1]).catch(error=>{process.send?.({type:'failed',code:error.code||'worker_start_failed'});process.exit(1);});}else if(args.length===1&&args[0]==='--run')run().catch(error=>{console.error(error.message);process.exitCode=1;});else{console.error('Use --run after the stock runtime is ready.');process.exitCode=1;}}
