import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient, followNativeResponse } from './m1-client.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8080', PROJECT = '/Root/Content/timelines', SOURCE_COUNT = 2998;
const REPORT = path.join(local.ROOT, 'm1-concurrency-report.json'), STATE = path.join(local.ROOT, 'm1-concurrency-state.json');
const SCOPES = ['content:read','media:write'];
const client = () => createClient({ baseUrl: GATEWAY + '/api/v1', repository: local.REPOSITORY, authority: local.AUTHORITY, project: PROJECT, caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
let restoredIds;
const protectedIds = () => restoredIds ||= new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT, 'restore-journal.json'), 'utf8')).idMap).map(Number));
const errorInfo = error => ({ status: error.status ?? null, code: error.code || (error.name === 'AssertionError' ? 'concurrency_assertion_failed' : 'concurrency_transport_failed'), location:error.stack?.split('\n').find(line=>/m1-concurrency-smoke\.mjs:\d+:\d+/.test(line))?.trim() });
function saveState(state) {
  assert.equal(path.dirname(STATE), path.resolve(local.ROOT));
  execFileSync('git', ['check-ignore','--quiet',STATE], { stdio: 'ignore', windowsHide: true });
  const temporary = STATE + '.' + randomUUID() + '.tmp', handle = fs.openSync(temporary, 'wx', 0o600);
  try {
    if (process.platform === 'win32') {
      const user = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : process.env.USERNAME;
      if (!user) throw new Error('Private state owner is unavailable.');
      execFileSync('icacls.exe', [temporary,'/inheritance:r','/grant:r',user + ':(F)'], { stdio: 'ignore', windowsHide: true });
    }
    fs.writeFileSync(handle, JSON.stringify(state,null,2)); fs.fsyncSync(handle);
  } catch { fs.closeSync(handle); fs.unlinkSync(temporary); throw new Error('Private smoke state could not be saved.'); }
  fs.closeSync(handle); fs.renameSync(temporary, STATE);
}
function loadState() {
  const state = JSON.parse(fs.readFileSync(STATE,'utf8'));
  assert.equal(state.version, 3); assert.equal(state.gateway,GATEWAY); assert.equal(state.repository,local.REPOSITORY); assert.equal(state.project,PROJECT);
  assert.match(state.prefix,/^m1-concurrency-[0-9a-f-]{36}$/); assert.ok(Array.isArray(state.fixtures)); return state;
}
function assertOwned(state, value) {
  assert.ok(!protectedIds().has(value.Id));
  assert.equal(value.Type,'MediaItem'); assert.equal(value.Name,state.reservation.name); assert.equal(value.Path,state.reservation.path);
  assert.ok(value.Name.startsWith(state.prefix)); return value;
}
async function sourceCount() {
  const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top':'0', '$inlinecount':'allpages', metadata:'no' }), { account:local.readAccounts().admin });
  assert.equal(response.status,200); const count = Number(response.value?.d?.__count); assert.ok(Number.isSafeInteger(count)); return count;
}
function success(response) {
  const value = response.value ?? JSON.parse(response.body.toString());
  if (response.status < 200 || response.status >= 300 || value?.ok === false) {
    const error = new Error('Application request rejected.'); Object.assign(error, { status:response.status, code:value?.error?.code || 'native_request_failed', result:value }); throw error;
  }
  return value;
}
async function request(api, route, options = {}) {
  const auth = { token: options.token, backendAuth: options.backendAuth };
  return followNativeResponse(await api.rawRequest(route,options), (nextRoute,nextOptions) => api.rawRequest(nextRoute,{...nextOptions,...auth}));
}
const read = async (api,state,id) => (await api.request('/content/'+id,{token:state.grant.token})).data;
async function preview(api,state,commands) { const plan = await api.request('/plans',{method:'POST',token:state.grant.token,body:{commands}}); assert.equal(plan.repositoryWrites,0); return plan; }
const apply = (api,state,plan,key) => request(api,'/plans/'+plan.id+'/apply',{method:'POST',token:state.grant.token,body:{},idempotencyKey:key});

/** Public app API only for writes. Preserve private state if native cleanup needs recovery. */
export async function cleanup(state = loadState()) {
  const api = client(), results = [];
  await api.verify();
  if (state.grant?.token) {
    try {
      const found = (await api.request('/lookup',{method:'POST',token:state.grant.token,body:{target:state.reservation.path}})).data;
      assertOwned(state,found);
      if (!state.fixtures.some(row => row.id === found.Id)) { state.fixtures.push({id:found.Id,name:found.Name,path:found.Path}); saveState(state); }
    } catch (error) { if (error.status !== 404) throw error; }
    for (const fixture of state.fixtures) {
      let current;
      try { current = await read(api,state,fixture.id); } catch (error) {
        if (error.status === 404) {
          if (state.cleanupOperation?.targetId === fixture.id && !state.cleanupOperation.completed) { const result = success(await apply(api,state,state.cleanupOperation.plan,state.cleanupOperation.key)); assert.equal(result.ok,true);state.cleanupOperation.completed=true;saveState(state); }
          results.push({id:fixture.id,deleted:true,alreadyAbsent:true});continue;
        }
        throw error;
      }
      assertOwned(state,current); assert.equal(current.Name,fixture.name); assert.equal(current.Path,fixture.path);
      if (state.cleanupOperation?.targetId !== fixture.id || state.cleanupOperation.completed) { const plan = await preview(api,state,[{action:'delete',targetId:current.Id,expectedRevision:current.revision}]);state.cleanupOperation = {targetId:fixture.id,plan,key:randomUUID(),completed:false};saveState(state); }
      const result = success(await apply(api,state,state.cleanupOperation.plan,state.cleanupOperation.key)); assert.equal(result.ok,true);state.cleanupOperation.completed=true;saveState(state);
      await assert.rejects(read(api,state,fixture.id), error => error.status === 404);
      results.push({id:fixture.id,deleted:true,via:'native-app'}); state.cleanup = results; saveState(state);
    }
    assert.equal(await sourceCount(),SOURCE_COUNT,'Restored source count changed after native cleanup.');
    await api.request('/grants/'+state.grant.id+'/revoke',{method:'POST',token:state.grant.token,body:{}});
    state.grant.token = null;
  }
  assert.equal(await sourceCount(),SOURCE_COUNT); state.phase = 'cleaned'; state.cleanup = results; saveState(state); return results;
}

/** Two independent simultaneous HTTPS callers exercise the one Netlify application. */
export async function run() {
  if (fs.existsSync(STATE)) {
    const previous = JSON.parse(fs.readFileSync(STATE,'utf8')); assert.ok(['completed','cleaned'].includes(previous.phase),'A previous concurrency fixture needs --cleanup first.');
  }
  const state = {version:3,phase:'preparing',gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,prefix:'m1-concurrency-'+randomUUID(),fixtures:[]};
  state.reservation = {name:state.prefix+'-same-key',path:PROJECT+'/MediaLibrary/'+state.prefix+'-same-key'};
  saveState(state);
  const checks = [], report = {version:3,architecture:'one-netlify-app-private-blobs-coordination',gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,ranAt:new Date().toISOString(),fixturePrefix:state.prefix,checks,cleanup:[],passed:false,
    limitation:'Actual concurrent HTTPS callers and repository postconditions through one local Netlify app. Cloud CAS, interrupted upstream commits and raw external writers need separate validation.'};
  const record = (name,details={}) => { checks.push({name,...details,passed:true}); console.log(JSON.stringify(checks.at(-1))); };
  const a = client(), b = client(); let failure;
  try {
    const capabilities = await a.verify(); await b.verify();
    assert.equal(capabilities.runtime,'Netlify Functions in the Timeline app'); assert.equal(capabilities.backendProtocolRequired,'gateway-coordinated-v1');
    protectedIds(); report.initialCount = await sourceCount(); assert.equal(report.initialCount,SOURCE_COUNT,'Run only after other owned fixture phases finish.');
    state.grant = await a.request('/grants',{method:'POST',token:local.readAccounts().editor.apiKey,backendAuth:'ApiKey',body:{scopes:SCOPES,expiresInSeconds:3600}}); saveState(state);
    state.createPlan = await preview(a,state,[{action:'create',type:'MediaItem',fields:{Name:state.reservation.name,DisplayName:'Owned app concurrency fixture',Title:'Owned concurrent media',MediaType:'movie',Description:'Before concurrent updates'}}]);
    state.createKey = randomUUID(); saveState(state);
    const options = {method:'POST',token:state.grant.token,body:{},idempotencyKey:state.createKey};
    const initial = await Promise.all([a.rawRequest('/plans/'+state.createPlan.id+'/apply',options),b.rawRequest('/plans/'+state.createPlan.id+'/apply',options)]);
    const pending = initial.map(response => JSON.parse(response.body.toString()));
    assert.ok(initial.every(response => response.status === 202)); assert.ok(pending.every(value => value.pending === true && typeof value.job?.id === 'string'));
    assert.equal(pending[0].job.id,pending[1].job.id,'Simultaneous same-key requests did not observe the same durable app job.');
    state.createJobId = pending[0].job.id; saveState(state);
    const finalized = await Promise.all(initial.map((response,index) => followNativeResponse(response,(route,init) => [a,b][index].rawRequest(route,{...init,token:state.grant.token}))));
    const creates = finalized.map(success); assert.deepEqual(creates[0],creates[1]);
    const id = creates[0].completed[0].result.id; assert.ok(Number.isSafeInteger(id));
    const content = assertOwned(state,await read(a,state,id)); state.fixtures.push({id,name:content.Name,path:content.Path}); saveState(state);
    assert.equal(await sourceCount(),SOURCE_COUNT+1);
    record('Two simultaneous same-plan/key HTTP callers share one durable job and exactly one content ID',{callers:2,jobId:state.createJobId,ownedContents:1});

    state.competing = [
      {plan:await preview(a,state,[{action:'update',targetId:id,expectedRevision:content.revision,fields:{Description:'Caller A reviewed update'}}]),key:randomUUID(),description:'Caller A reviewed update'},
      {plan:await preview(b,state,[{action:'update',targetId:id,expectedRevision:content.revision,fields:{Description:'Caller B reviewed update'}}]),key:randomUUID(),description:'Caller B reviewed update'},
    ]; saveState(state);
    const responses = await Promise.all(state.competing.map((operation,index) => apply([a,b][index],state,operation.plan,operation.key)));
    const winners = responses.map((response,index) => ({response,index})).filter(({response}) => response.status === 200 && response.value?.ok === true);
    assert.equal(winners.length,1,'Competing saved revisions did not produce exactly one successful update.');
    const winner = winners[0].index, loser = 1-winner; assert.equal(responses[loser].status,409);
    const current = await read(b,state,id); assert.equal(current.Description,state.competing[winner].description); assert.notEqual(current.revision,content.revision);
    // A conclusive before-dispatch busy result may be retried explicitly with the SAME saved key.
    // It must now reject the stale revision without another repository write.
    const loserReplay = await apply([a,b][loser],state,state.competing[loser].plan,state.competing[loser].key);
    assert.equal(loserReplay.status,409); assert.equal(loserReplay.value?.error?.code,'revision_conflict');
    const winnerReplay = success(await apply([a,b][loser],state,state.competing[winner].plan,state.competing[winner].key));
    assert.deepEqual(winnerReplay,responses[winner].value); assert.equal((await read(a,state,id)).revision,current.revision); assert.equal(await sourceCount(),SOURCE_COUNT+1);
    record('Competing keys pinned to one revision yield one save and a 409; explicit same-key retry confirms the stale revision',{winner: winner === 0 ? 'A':'B',initialLoserCode:responses[loser].value?.error?.code,staleStatus:409});
    record('Committed winner receipt replays through the other HTTP caller without another save');
  } catch (error) { failure=error; report.error=errorInfo(error); state.phase='failed'; saveState(state); }
  finally {
    try { report.cleanup = await cleanup(state); report.finalCount = await sourceCount(); assert.equal(report.finalCount,SOURCE_COUNT); }
    catch (error) { failure ||= error; report.cleanupError=errorInfo(error); state.phase='cleanup_failed'; saveState(state); }
    report.passed=!failure; if(report.passed){state.phase='completed';saveState(state);} fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleaned:report.cleanup.filter(item=>item.deleted).length,initialCount:report.initialCount,finalCount:report.finalCount,report:REPORT}));
  if(failure)throw new Error('Netlify app concurrency acceptance failed; inspect the sanitized report and retained private state.'); return report;
}
if(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if(args.length===1 && args[0]==='--run')run().catch(()=>{console.error('netlify_concurrency_failed');process.exitCode=1;});
  else if(args.length===1 && args[0]==='--cleanup')cleanup().then(result=>console.log(JSON.stringify({cleaned:result.length,sourceCount:SOURCE_COUNT}))).catch(()=>{console.error('netlify_concurrency_cleanup_failed');process.exitCode=1;});
  else {console.error('Use --run after the managed Netlify app is ready, or --cleanup for a retained owned fixture.');process.exitCode=1;}
}
