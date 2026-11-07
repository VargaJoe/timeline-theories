import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationGuard, guardRepository, snapshotRequestInit } from '../client/services/operationGuard.mjs';
import { validateProfile } from '../client/profile.mjs';
import { bindSnAuthStorage } from '../client/context/snAuthStorage.mjs';

function storageTab(values = new Map()) {
  // Separate prototypes represent separate browser windows sharing one origin.
  class TabStorage {
    getItem(key) { return values.get(String(key)) ?? null; }
    setItem(key, value) { values.set(String(key), String(value)); }
    removeItem(key) { values.delete(String(key)); }
  }
  return new TabStorage();
}

test('SNAuth refuses unattributed legacy tokens before the SDK provider mounts', () => {
  const values = new Map([['sn-auth-access-token', 'legacy-access'], ['sn-auth-refresh-token', 'legacy-refresh'], ['sn-auth-user-details', 'legacy-user']]);
  const storage = storageTab(values);
  bindSnAuthStorage(storage, { repositoryUrl:'https://repository.example', authority:'https://auth.example', clientId:'public-client' });
  for (const key of ['sn-auth-access-token','sn-auth-refresh-token','sn-auth-user-details']) assert.equal(values.has(key),false);
});

test('SNAuth isolates late writes from another profile and retains the exact profile session', () => {
  const values = new Map();
  const storage = storageTab(values);
  const profile = { repositoryUrl:'https://repository.example', authority:'https://auth.example', clientId:'public-client' };
  bindSnAuthStorage(storage,profile);
  storage.setItem('sn-auth-access-token','owned-access');
  bindSnAuthStorage(storage,profile);
  assert.equal(storage.getItem('sn-auth-access-token'),'owned-access');
  const otherTab = storageTab(values);
  bindSnAuthStorage(otherTab,{...profile,repositoryUrl:'https://other-repository.example'});
  storage.setItem('sn-auth-access-token','late-old-tab-refresh');
  assert.equal(otherTab.getItem('sn-auth-access-token'),null);
  otherTab.setItem('sn-auth-access-token','other-access');
  assert.equal(storage.getItem('sn-auth-access-token'),'late-old-tab-refresh');
  const reopened = storageTab(values);
  bindSnAuthStorage(reopened,profile);
  assert.equal(reopened.getItem('sn-auth-access-token'),'late-old-tab-refresh');
  assert.throws(() => bindSnAuthStorage(storage,{...profile,authority:'https://other-auth.example'}));
  storage.setItem('unrelated','preserved');
  assert.equal(otherTab.getItem('unrelated'),'preserved');
  storage.removeItem('sn-auth-access-token');
  assert.equal(otherTab.getItem('sn-auth-access-token'),'other-access');
});

function fixture(options={}) {
  const writes=[];
  const raw={post:async value=>writes.push(value),patch:async value=>writes.push(value),delete:async value=>writes.push(value),load:async()=>({d:{}}),loadCollection:async()=>({d:{results:[]}}),fetch:async()=>writes.push('fetch')};
  const guard=createOperationGuard({probe:async()=>true,childTypes:async()=>['MediaItem','TimelineEntry'],writable:()=>true,identity:()=> 'reader',...options});
  return {guard,repository:guardRepository(raw,guard),writes};
}
for(const result of [false,undefined,'true',{isError:false,error:'SiteUrl is missing'}]) test('unknown/denied permission never dispatches: '+JSON.stringify(result),async()=>{
  const f=fixture({probe:async()=>result});
  await assert.rejects(f.repository.post({parentPath:'/Root/Content/library',contentType:'MediaItem'}));
  await assert.rejects(f.repository.patch({idOrPath:42}));
  await assert.rejects(f.repository.delete({idOrPath:42}));
  assert.equal(f.writes.length,0);
});
for(const status of [404,401,403,500,'TLS','network']) test('read failure does not create: '+status,async()=>{
  const f=fixture();
  const repository=guardRepository({load:async()=>{throw new Error(String(status));}},f.guard);
  await assert.rejects(repository.load({idOrPath:'/Root/Content/library'}),new RegExp(String(status)));
  assert.equal(f.writes.length,0);
});
test('read facade trusts the actual load and collection GET without a redundant permission probe',async()=>{
  let probes=0,reads=0;
  const f=fixture({probe:async()=>{probes++;return false;}});
  const repository=guardRepository({load:async options=>{reads++;return options;},loadCollection:async options=>{reads++;return options;}},f.guard);
  assert.deepEqual(await repository.load({idOrPath:42}),{idOrPath:42});
  assert.deepEqual(await repository.loadCollection({path:'/Root/Content/library'}),{path:'/Root/Content/library'});
  assert.equal(reads,2);assert.equal(probes,0);
});
test('allowed child type does not substitute for AddNew',async()=>{
  const f=fixture({probe:async()=>false});
  assert.equal(await f.guard.can([{target:5,action:'create',contentType:'MediaItem'}]),false);
});
test('all batch targets checked before a write',async()=>{
  const f=fixture({probe:async target=>target!==2});
  await assert.rejects(f.guard.assert([{target:1,action:'update'},{target:2,action:'update'}]));
  assert.equal(f.writes.length,0);
});
test('identity change during permission discovery invalidates decision',async()=>{
  let current='editor'; const f=fixture({identity:()=>current,probe:async()=>{current='reader';return true;}});
  await assert.rejects(f.repository.patch({idOrPath:1})); assert.equal(f.writes.length,0);
});
test('revocation invalidates an in-flight decision',async()=>{
  let resolve; const f=fixture({probe:()=>new Promise(r=>{resolve=r;})});
  const pending=f.repository.patch({idOrPath:1});f.guard.invalidate();resolve(true);
  await assert.rejects(pending);assert.equal(f.writes.length,0);
});
test('remote/read-only targets cannot dispatch writes',async()=>{
  const f=fixture({writable:()=>false});await assert.rejects(f.repository.patch({idOrPath:1}));assert.equal(f.writes.length,0);
});
test('raw fetch writes are not a permission bypass',async()=>{
  const f=fixture();await assert.rejects(f.repository.fetch('https://localhost/api',{method:'POST'}));assert.equal(f.writes.length,0);
  await assert.rejects(f.repository.fetch(new Request('https://localhost/api',{method:'POST',body:'{}'})));assert.equal(f.writes.length,0);
});
test('explicit M0 profile rejects cloud or mixed authority',()=>{
  const profile={repositoryUrl:'https://localhost:41016',authority:'https://localhost:41017',authType:'IdentityServer',clientId:'public-spa',projectRoot:'/Root/Content/timelines',writable:true};
  assert.equal(validateProfile(profile,'m0-local').mode,'m0-local');
  assert.throws(()=>validateProfile({...profile,repositoryUrl:'https://plastice.sensenet.cloud'},'m0-local'));
  assert.throws(()=>validateProfile({...profile,authority:'https://auth.sensenet.com'},'m0-local'));
  assert.throws(()=>validateProfile({...profile,repositoryUrl:'https://user:secret@localhost:41016'},'m0-local'));
  assert.equal(validateProfile({...profile,repositoryUrl:'https://repository.example',authority:'https://auth.example'},'production').writable,true);
  assert.throws(()=>validateProfile({...profile,apiKey:'must-not-bundle'},'m0-local'));
  assert.throws(()=>validateProfile({...profile,writable:'true'},'m0-local'));
  assert.throws(()=>validateProfile({...profile,projectRoot:'/Root/Content/timelines/../other'},'m0-local'));
});
test('a batch context cannot continue after logout or revocation',()=>{
  let current='editor'; const f=fixture({identity:()=>current});
  const check=f.guard.context(); current='reader'; assert.throws(check);
  current='editor'; const second=f.guard.context(); f.guard.invalidate(); assert.throws(second);
});
test('caller mutations cannot turn a pending read into a write',async()=>{
  let release; const writes=[];
  const raw={fetch:async (url,init)=>{await new Promise(r=>release=r);writes.push(init.method);}};
  const f=fixture(); const facade=guardRepository(raw,f.guard);
  const init={method:'GET',headers:{'X-Test':'safe'}};
  const pending=facade.fetch('https://localhost/odata.svc/',init);
  init.method='POST'; init.body='{}'; init.headers['X-Test']='changed';release();await pending;
  assert.deepEqual(writes,['GET']);
  const form=new FormData();form.append('FileName','checked');
  const copied=snapshotRequestInit({method:'POST',body:form});form.set('FileName','changed');
  assert.equal(copied.body.get('FileName'),'checked');
});
test('batch probe receives all concrete operations once without the legacy per-target probes',async()=>{
  const calls=[];
  const f=fixture({probe:async()=>{throw Error('legacy permission probe');},childTypes:async()=>{throw Error('legacy child-type probe');},batchProbe:async operations=>{calls.push(operations);return true;}});
  const operations=Array.from({length:100},(_,index)=>({target:index+1,action:index%2?'delete':'update'}));
  await f.guard.assert(operations);
  assert.equal(calls.length,1);assert.deepEqual(calls[0],operations);
  assert.notEqual(calls[0],operations);assert.notEqual(calls[0][0],operations[0]);
});
for(const result of [false,undefined,'true',{allowed:true}]) test('batch probe fails closed unless explicitly true: '+JSON.stringify(result),async()=>{
  const f=fixture({batchProbe:async()=>result});
  await assert.rejects(f.repository.patch({idOrPath:1}),/Permission denied/);assert.equal(f.writes.length,0);
});
test('invalid batch targets and actions are rejected before any permission request',async()=>{
  let probes=0;
  const f=fixture({batchProbe:async()=>{probes++;return true;}});
  for(const operation of [{target:0,action:'update'},{target:1,action:'unknown'},{target:'',action:'read'}]) {
    await assert.rejects(f.guard.assert([{target:1,action:'update'},operation]),/Unknown operation target/);
  }
  assert.equal(probes,0);assert.equal(f.writes.length,0);
});
test('read-only batch writes are rejected before the compound probe',async()=>{
  let probes=0;
  const f=fixture({writable:()=>false,batchProbe:async()=>{probes++;return true;}});
  await assert.rejects(f.repository.patch({idOrPath:1}),/read only/);
  assert.equal(probes,0);assert.equal(f.writes.length,0);
});
for(const change of ['identity','revision']) test('a '+change+' change during a batch invalidates the entire decision',async()=>{
  let current='editor',release;
  const f=fixture({identity:()=>current,batchProbe:()=>new Promise(resolve=>{release=resolve;})});
  const pending=f.repository.patch({idOrPath:1});
  if(change==='identity') current='next-editor'; else f.guard.invalidate();
  release(true);await assert.rejects(pending,/Identity or permissions changed/);assert.equal(f.writes.length,0);
});
test('caller mutations cannot replace operations during a pending batch',async()=>{
  let release,reviewed;
  const f=fixture({batchProbe:async operations=>{reviewed=operations;await new Promise(resolve=>{release=resolve;});return true;}});
  const operations=[{target:1,action:'create',contentType:'MediaItem'}];
  const pending=f.guard.assert(operations);
  operations[0].target=2;operations[0].contentType='Timeline';operations.push({target:3,action:'delete'});
  release();await pending;
  assert.deepEqual(reviewed,[{target:1,action:'create',contentType:'MediaItem'}]);
});
test('checked transport owns exactly one fresh write guard when the facade delegates to it',async()=>{
  let probes=0;const writes=[];
  const guard=createOperationGuard({probe:async()=>{throw Error('legacy probe');},childTypes:async()=>[],batchProbe:async operations=>{probes++;return operations[0].target===1;},writable:()=>true,identity:()=>'editor'});
  const raw={patch:async options=>{await guard.assert([{target:options.idOrPath,action:'update'}]);writes.push(options);}};
  const repository=guardRepository(raw,guard,{writesCheckedByTransport:true});
  await repository.patch({idOrPath:1});assert.equal(probes,1);assert.equal(writes.length,1);
  await assert.rejects(repository.patch({idOrPath:2}),/Permission denied/);assert.equal(probes,2);assert.equal(writes.length,1);
});
