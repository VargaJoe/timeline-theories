import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../client/api/store.mjs';
import { verifyAppStorage } from '../client/api/storage-selftest.mjs';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';

// Actual SDK -> local SDK HTTP/file server with its documented compatibility
// fixes. This covers private storage flow; only the parent's public Deploy
// Preview run can establish actual cloud conditional-write semantics.
let fixture;
before(async()=>{fixture=await startBlobFixture();});
after(async()=>{await fixture?.close();});
function config(extra={}){return{repositoryUrl:'https://unused.fixture.invalid',authority:'https://unused-auth.fixture.invalid',projectRoot:'/Root/Content/Storage-'+randomUUID(),deployContext:'deploy-preview',deployId:randomUUID(),blobOptions:fixture.blobOptions,...extra};}

test('once-per-deploy storage selftest uses actual SDK CAS, verifies cleanup and caches a tiny result',async()=>{
  const cfg=config(),first=new Store(cfg),independent=new Store(cfg);
  const results=await Promise.all([verifyAppStorage(cfg,first),verifyAppStorage(cfg,independent)]);
  assert.ok(results.some(result=>result.status===200));assert.ok(results.every(result=>[200,202].includes(result.status)));
  const completed=await verifyAppStorage(cfg,new Store(cfg));assert.equal(completed.status,200);const result=await completed.json();
  assert.equal(result.storageSelftest.passed,true);assert.equal(result.storageSelftest.checks.firstWriteWinners,1);
  for(const name of ['strongInitialRead','nonmatchingCasRejected','currentCasSucceeded','staleCasRejected','strongFinalRead','ownedCleanupVerified'])assert.equal(result.storageSelftest.checks[name],true);
  assert.equal(result.senseNetRequests,0);assert.equal(result.repositoryWrites,0);
  const records=await first.blobs.list({prefix:first.prefix+'storage-selftest/'});
  assert.equal(records.blobs.length,2);assert.equal(records.blobs.filter(row=>row.key.endsWith('/claim')).length,1);assert.equal(records.blobs.filter(row=>row.key.endsWith('/result')).length,1);assert.equal(records.blobs.some(row=>row.key.includes('/probes/')),false);
  assert.deepEqual(await(await verifyAppStorage(cfg,first)).json(),result);
});

test('production and absent trusted deployment identity are rejected before any storage write',async()=>{
  const cfg=config(),store=new Store(cfg);
  assert.equal((await verifyAppStorage({...cfg,deployContext:'production'},store)).status,404);
  assert.equal((await verifyAppStorage({...cfg,deployId:undefined},store)).status,503);
  assert.equal((await store.blobs.list({prefix:store.prefix})).blobs.length,0);
});

test('explicit app development can verify only app storage with a remote repository binding',async()=>{
  const cfg=config({deployContext:undefined,local:false,devRuntime:true,deployId:'local-app-development'}),store=new Store(cfg);
  const response=await verifyAppStorage(cfg,store);assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.storageSelftest.passed,true);assert.equal(result.senseNetRequests,0);assert.equal(result.repositoryWrites,0);
  assert.equal((await verifyAppStorage({...cfg,devRuntime:false},store)).status,404);
});

test('missing SDK ETag fails closed, cleans its internal UUID and preserves the failed result',async()=>{
  let probeWrites=0;const cfg=config();
  const withoutTags=new Store({...cfg,blobOptions:{...cfg.blobOptions,fetch:async(url,options)=>{
    assert.equal(new URL(url).origin,new URL(fixture.url).origin);
    if(options?.method?.toLowerCase()==='put'&&String(url).includes('/probes/')&&!String(url).includes('/api/v1/blobs/'))probeWrites++;
    const result=await fetch(url,options);
    if(options?.method?.toLowerCase()==='get'&&!new Headers(options.headers).get('accept')?.includes('signed-url')){const headers=new Headers(result.headers);headers.delete('etag');return new Response(result.body,{status:result.status,headers});}
    return result;
  }}});
  const response=await verifyAppStorage(cfg,withoutTags);assert.equal(response.status,503);const result=await response.json();
  assert.equal(result.storageSelftest.passed,false);assert.equal(result.storageSelftest.failedPhase,'etag_unavailable');assert.equal(result.storageSelftest.checks.ownedCleanupVerified,true);
  assert.equal(probeWrites,2);assert.equal((await verifyAppStorage(cfg,withoutTags)).status,503);assert.equal(probeWrites,2);
  assert.equal(result.senseNetRequests,0);assert.equal(result.repositoryWrites,0);
  const records=await withoutTags.blobs.list({prefix:withoutTags.prefix+'storage-selftest/'});assert.equal(records.blobs.some(row=>row.key.includes('/probes/')),false);
});
