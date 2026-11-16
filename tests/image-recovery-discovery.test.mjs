import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, hash, WRITER_REQUEST_DISCOVERY_LIMIT } from '../client/api/store.mjs';
import { DomainError } from '../client/domain/content.mjs';
import { imageOperationId } from '../client/api/image-assets.mjs';
import { discoverPendingImageDrafts } from '../client/api/image-recovery-discovery.mjs';

const root = '/Root/DiscoveryFixture', originalPrincipal = 'session:42:original-session';
function draft(principal = originalPrincipal, key) {
  const generationId = randomUUID(); key ??= `${generationId}:draft`;
  const original = { operationId: imageOperationId(principal, key, 'image-draft'), action:'image-draft', targetId:90, generationId, expectedRevision:'sha256:' + 'a'.repeat(64), manifest:{schemaVersion:1,kind:'timeline-composite',projectPath:root,ownerId:90,generationId,sourceIds:[8],sourceStamps:[{id:8,stamp:'b'.repeat(64)}],recipe:{template:'poster-strip-v1',sourceIds:[8]},variants:[]} };
  const payload = { ...original, requestHash: hash(original) };
  return { principal, operation_id:original.operationId, request_hash:payload.requestHash, payload:JSON.stringify(payload), before_state:'private original state', state:'pending', result:null, started:1 };
}
function registration(row, extra = {}) { return { requestId:randomUUID(), principal:row.principal, identity:42, operationId:row.operation_id, nonce:randomUUID(), ...extra }; }
function fixture(rows = [draft()], registrations = []) {
  const store = Object.create(Store.prototype), records = new Map(), state = { reads:[], writes:0, lists:0, owners:0, checks:0 };
  store.prefix = 'private-bound-state/';
  records.set('pending-mutations', { entries:Object.fromEntries(rows.map((row,index) => [String(index), row])) });
  for (const value of registrations) records.set('writer-requests/' + value.requestId, value);
  store.blobs = {
    async getWithMetadata(key, options) { assert.equal(options.consistency,'strong'); assert.equal(options.type,'json'); state.reads.push(key); const data=records.get(key.slice(store.prefix.length)); return data === undefined ? null : { data:structuredClone(data),etag:'immutable' }; },
    setJSON() { state.writes++; throw Error('Discovery must never write application state.'); },
    list(options) { state.lists++; assert.deepEqual(options,{prefix:store.prefix+'writer-requests/',paginate:true}); return (async function*(){ const keys=[...records.keys()].filter(key=>key.startsWith('writer-requests/')); yield {blobs:keys.map(key=>({key:store.prefix+key,etag:'immutable'}))}; })(); },
  };
  const context = { principal:'session:42:renewed-session', identity:{Id:42}, credential:{mode:'Bearer',value:'current-private-credential'}, scopes:['covers:write'], async check(){state.checks++;}, repo:{paths:{root},images:{async owner(id, options){state.owners++; assert.deepEqual(options,{write:true}); return {Id:id,Type:'Timeline',Title:'Current owner title'};}}} };
  return { store, records, state, context };
}

test('renewed owner discovery verifies exact draft/key and historical requests without writing or exposing private state', async () => {
  const row = draft(), exact = registration(row), foreignPrincipal = registration(row,{principal:'session:99:private-foreign'}), foreignIdentity = registration(row,{identity:99}), foreignOperation = registration(row,{operationId:randomUUID()});
  const f = fixture([row],[exact,foreignPrincipal,foreignIdentity,foreignOperation]), before = structuredClone([...f.records]);
  const result = await discoverPendingImageDrafts(f.context,f.store);
  assert.deepEqual(result,{data:[{operationId:row.operation_id,ownerId:90,title:'Current owner title',action:'image-draft',idempotencyKey:JSON.parse(row.payload).generationId+':draft',requestIds:[exact.requestId]}]});
  for (const value of [row.principal,row.before_state,row.payload,exact.nonce,foreignPrincipal.requestId,foreignIdentity.requestId,foreignOperation.requestId,f.context.credential.value]) assert.equal(JSON.stringify(result).includes(value),false);
  assert.equal(f.state.writes,0); assert.deepEqual([...f.records],before); assert.equal(f.state.owners,2);
});

test('original grant ownership follows its saved backend identity even after renewal, without exposing foreign pending state', async () => {
  const grantId=randomUUID(), own=draft('grant:'+grantId), foreign=draft('session:99:foreign'), exact=registration(own), f=fixture([own,foreign],[exact]);
  f.records.set('grant-ids/'+grantId,{id:grantId,identity:42,expires:1});
  assert.equal((await discoverPendingImageDrafts(f.context,f.store)).data[0].operationId,own.operation_id);
  f.records.set('grant-ids/'+grantId,{id:grantId,identity:99});
  assert.deepEqual(await discoverPendingImageDrafts(f.context,f.store),{data:[]});
  assert.equal(f.state.writes,0);
});

test('scope, current owner session, current credential and owner Save gate discovery', async () => {
  for (const fault of ['scope','grant','credential','identity-check','owner-save','owner-save-revoked']) {
    const row=draft(), f=fixture([row],[registration(row)]);
    if(fault==='scope')f.context.scopes=['content:read'];
    if(fault==='grant')f.context.grant={id:randomUUID()};
    if(fault==='credential')f.context.credential=null;
    if(fault==='identity-check')f.context.check=async()=>{throw new DomainError('credential_revoked','Expired current session.',401);};
    if(fault.startsWith('owner-save'))f.context.repo.images.owner=async()=>{if(fault==='owner-save'||++f.state.owners===2)throw new DomainError('backend_denied','Current Save denied.',403);return{Id:90,Title:'Private owner'};};
    if(fault.startsWith('owner-save'))assert.deepEqual(await discoverPendingImageDrafts(f.context,f.store),{data:[]});
    else await assert.rejects(discoverPendingImageDrafts(f.context,f.store),error=>['scope_denied','session_required','credential_revoked'].includes(error.code));
    if(['scope','grant','credential','identity-check'].includes(fault))assert.equal(f.state.reads.length,0);
    assert.equal(f.state.writes,0);
  }
});

test('malformed own drafts, altered hashes, foreign bindings and unproven original keys expose only an unsupported flag', async () => {
  const faults=['json','oversize','row-hash','payload-hash','operation','revision','project','owner','generation','unknown-property','custom-key','unsupported-action','not-pending'];
  for(const fault of faults){
    const row=draft(originalPrincipal,fault==='custom-key'?'different-original-key':undefined), payload=JSON.parse(row.payload);
    if(fault==='json')row.payload='{';
    else if(fault==='oversize')row.payload='x'.repeat(32769);
    else if(fault==='row-hash')row.request_hash='c'.repeat(64);
    else if(fault==='payload-hash')payload.requestHash='d'.repeat(64);
    else if(fault==='not-pending')row.state='completed';
    else if(fault!=='custom-key'){
      if(fault==='operation')payload.operationId=randomUUID();
      if(fault==='revision')payload.expectedRevision='unverified';
      if(fault==='project')payload.manifest.projectPath='/Root/Foreign';
      if(fault==='owner')payload.manifest.ownerId=91;
      if(fault==='generation')payload.manifest.generationId=randomUUID();
      if(fault==='unknown-property')payload.bytesBase64='private-image-bytes';
      if(fault==='unsupported-action')payload.action='image-variant';
      const{requestHash,...original}=payload;payload.requestHash=hash(original);row.request_hash=payload.requestHash;
    }
    if(!['json','oversize'].includes(fault))row.payload=JSON.stringify(payload);
    const f=fixture([row]);assert.deepEqual(await discoverPendingImageDrafts(f.context,f.store),{data:[],unsupportedPending:true},fault);
    assert.equal(f.state.owners,0);assert.equal(f.state.lists,0);assert.equal(f.state.writes,0);
  }
  const foreign=draft('session:99:private-foreign');foreign.payload='{';
  const f=fixture([foreign]);assert.deepEqual(await discoverPendingImageDrafts(f.context,f.store),{data:[]});
});

test('bounded, missing or mismatched registration history returns no guessed request IDs', async () => {
  for(const fault of ['empty','overflow','paged-overflow','missing','mismatched','invalid-key']){
    const row=draft(), exact=registration(row), f=fixture([row],fault==='empty'?[]:[exact]);
    if(fault==='overflow'||fault==='paged-overflow'){
      for(let i=0;i<WRITER_REQUEST_DISCOVERY_LIMIT;i++){const value=registration(row,{operationId:randomUUID()});f.records.set('writer-requests/'+value.requestId,value);}
      if(fault==='paged-overflow')f.store.blobs.list=()=> (async function*(){const keys=[...f.records.keys()].filter(key=>key.startsWith('writer-requests/'));for(let i=0;i<keys.length;i+=100)yield{blobs:keys.slice(i,i+100).map(key=>({key:f.store.prefix+key}))};})();
    }
    if(fault==='missing'){const read=f.store.blobs.getWithMetadata;f.store.blobs.getWithMetadata=(key,options)=>key.endsWith(exact.requestId)?null:read(key,options);}
    if(fault==='mismatched')f.records.set('writer-requests/'+exact.requestId,{...exact,requestId:randomUUID()});
    if(fault==='invalid-key')f.records.set('writer-requests/not-a-request',exact);
    const value=(await discoverPendingImageDrafts(f.context,f.store)).data[0];assert.deepEqual(value.requestIds,[],fault);assert.equal(value.requestReferenceRequired,true,fault);
    if(fault.includes('overflow'))assert.equal(f.state.reads.filter(key=>key.includes('/writer-requests/')).length,0,'Incomplete listings are discarded before metadata reads.');
    assert.equal(f.state.writes,0);
  }
});

test('exactly two hundred candidate registrations use strong bounded reads and return only matching original provenance', async () => {
  const row=draft(), exact=registration(row), registrations=[exact];
  for(let i=1;i<WRITER_REQUEST_DISCOVERY_LIMIT;i++)registrations.push(registration(row,{operationId:randomUUID()}));
  const f=fixture([row],registrations), value=(await discoverPendingImageDrafts(f.context,f.store)).data[0];
  assert.deepEqual(value.requestIds,[exact.requestId]);assert.equal(value.requestReferenceRequired,undefined);
  assert.equal(f.state.reads.filter(key=>key.includes('/writer-requests/')).length,WRITER_REQUEST_DISCOVERY_LIMIT);assert.equal(f.state.writes,0);
});

test('unreadable strong provenance cannot produce partial recovery references', async () => {
  const row=draft(), exact=registration(row), f=fixture([row],[exact]), read=f.store.blobs.getWithMetadata;
  f.store.blobs.getWithMetadata=(key,options)=>{if(key.endsWith(exact.requestId))throw new DomainError('state_unavailable','Strong provenance read failed.',503);return read(key,options);};
  await assert.rejects(discoverPendingImageDrafts(f.context,f.store),error=>error.code==='state_unavailable');assert.equal(f.state.writes,0);
});
