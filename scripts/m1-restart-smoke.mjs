import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createClient, followNativeResponse } from './m1-client.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8080', PROJECT = '/Root/Content/timelines', SOURCE_COUNT = 2998;
const STATE = path.join(local.ROOT,'m1-restart-state.json'), REPORT = path.join(local.ROOT,'m1-restart-report.json');
const SCOPES = ['content:read','timelines:write','media:write','entries:write'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceId = value => Array.isArray(value) ? referenceId(value[0]) : value && typeof value === 'object' ? value.Id : value;
const errorInfo = error => ({ status:error.status ?? null,code:error.code || (error.name === 'AssertionError' ? 'restart_assertion_failed':'restart_transport_failed'),location:error.stack?.split('\n').find(line=>/m1-restart-smoke\.mjs:\d+:\d+/.test(line))?.trim() });
const client = () => createClient({baseUrl:GATEWAY+'/api/v1',repository:local.REPOSITORY,authority:local.AUTHORITY,project:PROJECT,caFile:path.join(local.ROOT,'certificates/localhost.pem')});
let restoredIds;
const protectedIds = () => restoredIds ||= new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8')).idMap).map(Number));

/** Plaintext grant exists only in an ignored, owner-only file; atomic replacement keeps that ACL. */
function saveState(state) {
  assert.equal(path.dirname(STATE),path.resolve(local.ROOT));
  execFileSync('git',['check-ignore','--quiet',STATE],{stdio:'ignore',windowsHide:true});
  const temporary = STATE+'.'+randomUUID()+'.tmp', handle = fs.openSync(temporary,'wx',0o600);
  try {
    if(process.platform==='win32') {
      const user=process.env.USERDOMAIN ? process.env.USERDOMAIN+'\\'+process.env.USERNAME : process.env.USERNAME;
      if(!user)throw new Error('Private state owner is unavailable.');
      execFileSync('icacls.exe',[temporary,'/inheritance:r','/grant:r',user+':(F)'],{stdio:'ignore',windowsHide:true});
    }
    fs.writeFileSync(handle,JSON.stringify(state,null,2));fs.fsyncSync(handle);
  }catch{fs.closeSync(handle);fs.unlinkSync(temporary);throw new Error('Private restart state could not be saved.');}
  fs.closeSync(handle);fs.renameSync(temporary,STATE);
}
function loadState() {
  const state=JSON.parse(fs.readFileSync(STATE,'utf8'));
  assert.equal(state.version,3);assert.equal(state.gateway,GATEWAY);assert.equal(state.repository,local.REPOSITORY);assert.equal(state.project,PROJECT);
  assert.match(state.prefix,/^m1-restart-[0-9a-f-]{36}$/);assert.ok(Array.isArray(state.fixtures)&&Array.isArray(state.reservations)&&Array.isArray(state.operations));return state;
}
/** Verify the explicitly supplied managed CLI tree owns the HTTPS app listener; never stop it here. */
function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid)&&pid>0,'Supply the explicitly tracked Netlify CLI Node PID.');
  const command = `$taskRestartProcess=Get-Process -Id ${pid} -ErrorAction Stop; if($taskRestartProcess.ProcessName -ne 'node'){throw 'Tracked app process is not Node'}; $taskRestartCli=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($taskRestartCli.CommandLine -notmatch 'netlify'){throw 'Tracked process is not the managed Netlify CLI'}; $taskRestartListeners=@(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique); $taskRestartOwnsListener=$false; foreach($taskRestartListener in $taskRestartListeners){$taskRestartCursor=[int]$taskRestartListener;for($taskRestartDepth=0;$taskRestartDepth -lt 10;$taskRestartDepth++){if($taskRestartCursor -eq ${pid}){$taskRestartOwnsListener=$true;break};$taskRestartAncestor=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskRestartCursor);if(!$taskRestartAncestor -or $taskRestartAncestor.ParentProcessId -eq 0){break};$taskRestartCursor=[int]$taskRestartAncestor.ParentProcessId}};if(!$taskRestartOwnsListener){throw 'Tracked Netlify tree does not own localhost 8080'};@{pid=$taskRestartProcess.Id;startedAt=$taskRestartProcess.StartTime.ToUniversalTime().ToString('o');ownsAppListener=$true}|ConvertTo-Json -Compress`;
  const value=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true}).trim());
  assert.equal(value.pid,pid);assert.equal(value.ownsAppListener,true);return value;
}
async function sourceCount() {
  const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:'+InTree:'+PROJECT+' .AUTOFILTERS:OFF .LIFESPAN:OFF','$top':'0','$inlinecount':'allpages',metadata:'no'}),{account:local.readAccounts().admin});
  assert.equal(response.status,200);const count=Number(response.value?.d?.__count);assert.ok(Number.isSafeInteger(count));return count;
}
async function assertApp(api) {
  const capabilities=await api.verify();assert.equal(capabilities.runtime,'Netlify Functions in the Timeline app');assert.equal(capabilities.backendProtocolRequired,'gateway-coordinated-v1');return capabilities;
}
function success(response) {
  const value=response.value??JSON.parse(response.body.toString());
  if(response.status<200||response.status>=300||value?.ok===false){const error=new Error('Application request rejected.');Object.assign(error,{status:response.status,code:value?.error?.code||'native_request_failed',result:value});throw error;}
  return value;
}
async function request(api,state,route,options={}) {
  const original={token:state.grant.token};
  return followNativeResponse(await api.rawRequest(route,{...options,...original}),(nextRoute,nextOptions)=>api.rawRequest(nextRoute,{...nextOptions,...original}));
}
const read=async(api,state,id)=>(await api.request('/content/'+id,{token:state.grant.token})).data;
const lookup=async(api,state,target)=>(await api.request('/lookup',{method:'POST',token:state.grant.token,body:{target}})).data;
const list=async(api,state)=>(await api.request('/entries?'+new URLSearchParams({timelineId:String(state.timelineId),top:'100',includeHidden:'true'}),{token:state.grant.token})).items;
async function preview(api,state,commands){const plan=await api.request('/plans',{method:'POST',token:state.grant.token,body:{commands}});assert.equal(plan.repositoryWrites,0);return plan;}
function own(state,content) {
  assert.ok(!protectedIds().has(content.Id),'Fixture resolved to a restored source ID.');
  assert.ok(content.Name.startsWith(state.prefix)&&content.Path.startsWith(PROJECT+'/'));
  const exact=state.reservations.find(row=>row.name===content.Name&&row.path===content.Path&&row.type===content.Type);assert.ok(exact,'Exact reserved UUID/type/path ownership is unavailable.');return content;
}
function remember(state,content) {
  own(state,content);const value={id:content.Id,name:content.Name,path:content.Path,type:content.Type,deleted:false};
  const existing=state.fixtures.find(row=>row.id===content.Id);if(existing)Object.assign(existing,value);else state.fixtures.push(value);saveState(state);return content;
}
function reserveName(state,type,name,parentPath){assert.ok(name.startsWith(state.prefix));state.reservations.push({type,name,path:parentPath+'/'+name});saveState(state);}
function operation(state,kind,plan,lost=false){const row={kind,plan,key:randomUUID(),lost};state.operations.push(row);saveState(state);return row;}

/** Drain and discard an actual final HTTPS job body. It is never parsed as an apply receipt. */
async function discardCompletedResponse(api,state,step,initial) {
  assert.equal(initial.status,202,'Fresh apply did not return an asynchronous app job.');
  const queued=JSON.parse(initial.body.toString());assert.equal(queued.pending,true);assert.match(queued.job?.id,/^[0-9a-f-]{36}$/);
  step.jobId=queued.job.id;saveState(state);
  const deadline=Date.now()+15*60*1000;let response=initial;
  for(;;) {
    if(response.status!==202) {
      assert.equal(response.status,200,'The discarded apply response did not fully complete.');
      step.discarded={status:response.status,bytes:response.body.length,sha256:sha256(response.body),completedAt:new Date().toISOString()};
      response.body.fill(0);saveState(state);return;
    }
    const pending=JSON.parse(response.body.toString());assert.equal(pending.pending,true);assert.equal(pending.job?.id,step.jobId);
    assert.ok(Date.now()<deadline,'Job remains pending; retain the original plan/key for recovery.');
    await new Promise(resolve=>setTimeout(resolve,500));
    response=await api.rawRequest('/jobs/'+step.jobId,{token:state.grant.token});
  }
}
async function apply(api,state,step) {
  const initial=await api.rawRequest('/plans/'+step.plan.id+'/apply',{method:'POST',token:state.grant.token,body:{},idempotencyKey:step.key});
  if(step.lost){await discardCompletedResponse(api,state,step,initial);return;}
  const result=success(await followNativeResponse(initial,(route,options)=>api.rawRequest(route,{...options,token:state.grant.token}),{onJob:id=>{step.jobId=id;saveState(state);}}));
  assert.equal(result.ok,true);step.completed=true;saveState(state);return result;
}
async function create(api,state,type,fields,parentId,parentPath) {
  reserveName(state,type,fields.Name,parentPath);
  const plan=await preview(api,state,[{action:'create',type,fields,...(parentId?{parentId}:{})}]);
  const result=await apply(api,state,operation(state,'setup-create',plan));return remember(state,await read(api,state,result.completed[0].result.id));
}

/** Prepare only UUID fixtures; leave the managed Netlify app running for the parent-controlled restart. */
export async function prepare(pid) {
  if(fs.existsSync(STATE)){const previous=JSON.parse(fs.readFileSync(STATE,'utf8'));assert.ok(['completed','cleaned'].includes(previous.phase),'Resume or clean the previous restart fixture first.');}
  const state={version:3,architecture:'one-netlify-app-private-blobs-restart',phase:'preparing',preparedAt:new Date().toISOString(),gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,prefix:'m1-restart-'+randomUUID(),processBefore:processIdentity(pid),fixtures:[],reservations:[],operations:[],checks:[]};
  saveState(state);const api=client();
  try {
    await assertApp(api);protectedIds();state.initialCount=await sourceCount();assert.equal(state.initialCount,SOURCE_COUNT,'Other owned fixture phases must finish first.');saveState(state);
    state.grant=await api.request('/grants',{method:'POST',token:local.readAccounts().editor.apiKey,backendAuth:'ApiKey',body:{scopes:SCOPES,expiresInSeconds:3600}});saveState(state);
    const timelineName=state.prefix+'-timeline',timeline=await create(api,state,'Timeline',{Name:timelineName,DisplayName:'Owned Netlify restart timeline',Description:'Own UUID fixture',IsVisible:false},undefined,PROJECT+'/Timelines');
    state.timelineId=timeline.Id;saveState(state);

    const mediaName=state.prefix+'-media';reserveName(state,'MediaItem',mediaName,PROJECT+'/MediaLibrary');
    const createPlan=await preview(api,state,[{action:'create',type:'MediaItem',fields:{Name:mediaName,DisplayName:'Owned restart media',Title:'One restored receipt creation',MediaType:'movie'}}]);
    await apply(api,state,operation(state,'create',createPlan,true));
    const media=remember(state,await lookup(api,state,PROJECT+'/MediaLibrary/'+mediaName));state.mediaId=media.Id;saveState(state);
    const entryNames=[state.prefix+'-first',state.prefix+'-second'];entryNames.forEach(name=>reserveName(state,'TimelineEntry',name,timeline.Path));
    const entriesPlan=await preview(api,state,entryNames.map((Name,index)=>({action:'create',type:'TimelineEntry',parentId:timeline.Id,fields:{Name,DisplayName:'Owned restart occurrence '+(index+1),MediaItem:media.Id,Position:index+1,Notes:'Own occurrence '+(index+1)}})));
    const entriesResult=await apply(api,state,operation(state,'setup-entries',entriesPlan));state.entryIds=entriesResult.completed.map(row=>row.result.id);assert.equal(new Set(state.entryIds).size,2);saveState(state);
    for(const id of state.entryIds)remember(state,await read(api,state,id));
    let first=await read(api,state,state.entryIds[0]);
    const updatePlan=await preview(api,state,[{action:'update',targetId:first.Id,expectedRevision:first.revision,fields:{Notes:'Notes survive discarded job response and Netlify restart'}}]);
    await apply(api,state,operation(state,'update',updatePlan,true));
    first=await read(api,state,first.Id);const second=await read(api,state,state.entryIds[1]);
    const orderPlan=await preview(api,state,[{action:'order',timelineId:timeline.Id,entries:[{id:second.Id,revision:second.revision},{id:first.Id,revision:first.revision}]}]);
    await apply(api,state,operation(state,'order',orderPlan,true));

    const disposable=await create(api,state,'MediaItem',{Name:state.prefix+'-deleted',DisplayName:'Owned lost delete fixture',Title:'Deletion receipt proof',MediaType:'movie'},undefined,PROJECT+'/MediaLibrary');
    const deletePlan=await preview(api,state,[{action:'delete',targetId:disposable.Id,expectedRevision:disposable.revision}]);
    await apply(api,state,operation(state,'delete',deletePlan,true));
    await assert.rejects(read(api,state,disposable.Id),error=>error.status===404);state.deletedId=disposable.Id;state.fixtures.find(row=>row.id===disposable.Id).deleted=true;saveState(state);

    const renamed=state.prefix+'-media-renamed';reserveName(state,'MediaItem',renamed,PROJECT+'/MediaLibrary');
    const beforeRename=await read(api,state,media.Id),renamePlan=await preview(api,state,[{action:'update',targetId:media.Id,expectedRevision:beforeRename.revision,fields:{Name:renamed}}]);
    await apply(api,state,operation(state,'setup-rename',renamePlan));remember(state,await read(api,state,media.Id));
    const competingTarget=await read(api,state,second.Id);
    const stalePlan=await preview(api,state,[{action:'update',targetId:second.Id,expectedRevision:competingTarget.revision,fields:{Notes:'Stale saved edit must not overwrite'}}]);state.stale=operation(state,'stale-after-restart',stalePlan);
    const competingPlan=await preview(api,state,[{action:'update',targetId:second.Id,expectedRevision:competingTarget.revision,fields:{Notes:'Competing app update survives Netlify restart'}}]);
    await apply(api,state,operation(state,'setup-competing-edit',competingPlan));
    state.baseline={};for(const fixture of state.fixtures.filter(row=>!row.deleted)){const current=await read(api,state,fixture.id);state.baseline[fixture.id]={revision:current.revision,name:current.Name,path:current.Path};}
    assert.equal((await list(api,state)).length,2);assert.equal((await read(api,state,first.Id)).Position,2);assert.equal((await read(api,state,second.Id)).Position,1);
    assert.equal(await sourceCount(),SOURCE_COUNT+4);state.phase='prepared';state.resumeBefore=stalePlan.expiresAt;state.preparedAt=new Date().toISOString();saveState(state);
    console.log(JSON.stringify({phase:state.phase,stateFile:STATE,lostCompletedBodies:state.operations.filter(row=>row.lost).length,activeOwnedFixtures:4,sourceCount:SOURCE_COUNT,readyForManagedAppRestart:true,resumeBefore:state.resumeBefore}));return state;
  }catch(error){state.phase='prepare_failed';state.error=errorInfo(error);saveState(state);throw error;}
}

/** All fixture discovery and deletion uses the scoped application API, with no raw cleanup fallback. */
export async function cleanup(state=loadState()) {
  const api=client(),results=[];await assertApp(api);
  if(state.grant?.token) {
    for(const reservation of state.reservations) {
      let content;try{content=await lookup(api,state,reservation.path);}catch(error){if(error.status===404)continue;throw error;}
      assert.equal(content.Name,reservation.name);assert.equal(content.Path,reservation.path);assert.equal(content.Type,reservation.type);remember(state,content);
    }
    const sorted=[...state.fixtures].sort((a,b)=>({TimelineEntry:0,Timeline:1,MediaItem:2,BookMediaItem:2}[a.type]-{TimelineEntry:0,Timeline:1,MediaItem:2,BookMediaItem:2}[b.type]));
    for(const fixture of sorted) {
      let current;try{current=await read(api,state,fixture.id);}catch(error){
        if(error.status===404){const pending=state.operations.find(row=>row.kind==='cleanup'&&row.targetId===fixture.id&&!row.completed);if(pending)await apply(api,state,pending);results.push({id:fixture.id,deleted:true,alreadyAbsent:true});continue;}
        throw error;
      }
      own(state,current);assert.equal(current.Name,fixture.name);assert.equal(current.Path,fixture.path);
      let step=state.operations.find(row=>row.kind==='cleanup'&&row.targetId===fixture.id&&!row.completed);
      if(!step){step=operation(state,'cleanup',await preview(api,state,[{action:'delete',targetId:fixture.id,expectedRevision:current.revision}]));step.targetId=fixture.id;saveState(state);}
      await apply(api,state,step);await assert.rejects(read(api,state,fixture.id),error=>error.status===404);
      fixture.deleted=true;results.push({id:fixture.id,deleted:true,via:'native-app'});state.cleanup=results;saveState(state);
    }
    assert.equal(await sourceCount(),SOURCE_COUNT,'Restored source count changed after cleanup.');
    await api.request('/grants/'+state.grant.id+'/revoke',{method:'POST',token:state.grant.token,body:{}});state.grant.token=null;
  }
  assert.equal(await sourceCount(),SOURCE_COUNT);state.phase='cleaned';state.cleanup=results;saveState(state);return results;
}

/** Resume after the parent actually restarts its managed CLI, preserving the private app Blobs store. */
export async function resume(pid) {
  const state=loadState();assert.equal(state.phase,'prepared');const processAfter=processIdentity(pid);assert.notDeepEqual(processAfter,state.processBefore,'The managed Netlify app process did not restart.');
  const report={version:3,architecture:state.architecture,ranAt:new Date().toISOString(),gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,fixturePrefix:state.prefix,processBefore:state.processBefore,processAfter,lostCompletedBodies:state.operations.filter(row=>row.lost).length,initialCount:state.initialCount,checks:[],cleanup:[],passed:false,
    limitation:'Real completed HTTP bodies are consumed and discarded, then the managed Netlify CLI is restarted with its normal app Blobs preserved. This proves completed receipt/job durability; it does not inject an unknown upstream commit or recover an interrupted writer.'};
  const api=client();let failure;
  const record=(name,details={})=>{report.checks.push({name,...details,passed:true});console.log(JSON.stringify(report.checks.at(-1)));};
  try {
    await assertApp(api);assert.ok(Date.now()<Date.parse(state.resumeBefore),'Resume before the saved stale plan expires to distinguish revision conflict from expiry.');
    for(const step of state.operations.filter(row=>row.lost)) {
      const original=await api.rawRequest('/jobs/'+step.jobId,{token:state.grant.token});
      assert.equal(original.status,step.discarded.status);assert.equal(original.body.length,step.discarded.bytes);assert.equal(sha256(original.body),step.discarded.sha256);
      const result=success(original);assert.equal(result.ok,true);
      if(step.kind==='create')assert.equal(result.completed[0].result.id,state.mediaId);
      if(step.kind==='delete'){assert.equal(result.completed[0].result.id,state.deletedId);assert.equal(result.completed[0].result.deleted,true);}
      const replay=await request(api,state,'/plans/'+step.plan.id+'/apply',{method:'POST',body:{},idempotencyKey:step.key});assert.equal(replay.status,original.status);assert.equal(sha256(replay.body),step.discarded.sha256);
      record(step.kind+' original job and original plan/key return the exact discarded durable receipt',{jobId:step.jobId});
    }
    for(const fixture of state.fixtures.filter(row=>!row.deleted)){const current=own(state,await read(api,state,fixture.id));assert.equal(current.revision,state.baseline[fixture.id].revision);assert.equal(current.Name,state.baseline[fixture.id].name);assert.equal(current.Path,state.baseline[fixture.id].path);}
    await assert.rejects(read(api,state,state.deletedId),error=>error.status===404);
    const entries=await list(api,state);assert.equal(entries.length,2);assert.equal(new Set(entries.map(row=>row.Id)).size,2);assert.ok(entries.every(row=>referenceId(row.MediaItem)===state.mediaId));
    assert.equal((await read(api,state,state.entryIds[0])).Notes,'Notes survive discarded job response and Netlify restart');assert.equal((await read(api,state,state.entryIds[0])).Position,2);assert.equal((await read(api,state,state.entryIds[1])).Position,1);
    const oldMediaPath=state.reservations.find(row=>row.type==='MediaItem'&&row.name===state.prefix+'-media').path;await assert.rejects(lookup(api,state,oldMediaPath),error=>error.status===404);
    assert.equal(await sourceCount(),SOURCE_COUNT+4);
    record('One creation retains its renamed ID; revisions, two shared-media occurrences, order and deletion remain unchanged');
    const stale=await request(api,state,'/plans/'+state.stale.plan.id+'/apply',{method:'POST',body:{},idempotencyKey:state.stale.key});assert.equal(stale.status,409);assert.equal(stale.value?.error?.code,'revision_conflict');
    assert.equal((await read(api,state,state.entryIds[1])).Notes,'Competing app update survives Netlify restart');
    record('Saved stale revision fails after restart with 409 and preserves the competing app update');
  }catch(error){failure=error;report.error=errorInfo(error);}
  try{report.cleanup=await cleanup(state);report.finalCount=await sourceCount();assert.equal(report.finalCount,SOURCE_COUNT);state.phase=failure?'cleaned':'completed';state.processAfter=processAfter;saveState(state);}
  catch(error){failure ||= error;report.cleanupError=errorInfo(error);state.phase='cleanup_failed';saveState(state);}
  report.passed=!failure;fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,actualManagedAppRestart:true,lostCompletedBodies:report.lostCompletedBodies,cleaned:report.cleanup.length,sourceCountBefore:report.initialCount,sourceCountAfter:report.finalCount,report:REPORT}));
  if(failure)throw new Error('Netlify app restart acceptance failed; inspect the sanitized report and retained private state.');return report;
}
async function main() {
  const args=process.argv.slice(2),phase=args[0];
  if(phase==='--cleanup'&&args.length===1){const rows=await cleanup();console.log(JSON.stringify({phase:'cleaned',cleaned:rows.length,sourceCount:SOURCE_COUNT}));return;}
  if(!['--prepare','--resume'].includes(phase)||args.length!==3||!['--app-pid','--gateway-pid'].includes(args[1])||!/^\d+$/.test(args[2]))throw new Error('Use --prepare or --resume --app-pid <managed Netlify CLI Node PID>, or --cleanup.');
  if(phase==='--prepare')await prepare(Number(args[2]));else await resume(Number(args[2]));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.code||'netlify_restart_failed');process.exitCode=1;});
