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
  const f=fixture({probe:async()=>{throw new Error(String(status));}});
  await assert.rejects(f.repository.load({idOrPath:'/Root/Content/library'}));
  assert.equal(f.writes.length,0);
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
test('local profile rejects cloud or mixed authority',()=>{
  const profile={repositoryUrl:'https://localhost:41016',authority:'https://localhost:41017',authType:'IdentityServer',clientId:'public-spa',projectRoot:'/Root/Content/timelines',writable:true};
  assert.equal(validateProfile(profile,'local').mode,'local');
  assert.throws(()=>validateProfile({...profile,repositoryUrl:'https://plastice.sensenet.cloud'},'local'));
  assert.throws(()=>validateProfile({...profile,authority:'https://auth.sensenet.com'},'local'));
  assert.throws(()=>validateProfile({...profile,repositoryUrl:'https://user:secret@localhost:41016'},'local'));
  assert.throws(()=>validateProfile(profile,'production'));
  assert.throws(()=>validateProfile({...profile,apiKey:'must-not-bundle'},'local'));
  assert.throws(()=>validateProfile({...profile,writable:'true'},'local'));
  assert.throws(()=>validateProfile({...profile,projectRoot:'/Root/Content/timelines/../other'},'local'));
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
