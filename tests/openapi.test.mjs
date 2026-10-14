import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Ajv from '../client/node_modules/ajv/lib/ajv.js';
import { openApi } from '../client/api/openapi.mjs';
import { validatePreviewUrl, verifyBinding, runCloudStateSmoke } from '../scripts/m1-cloud-state-smoke.mjs';
import { TRANSFER_CHUNK_BYTES, TRANSFER_INLINE_BYTES, TRANSFER_JSON_BYTES } from '../client/api/transfers.mjs';

const capabilities = { scopes: ['content:read','covers:write'], limits: { coverBytes: 10485760, zipBytes: 67108864, jsonBytes: TRANSFER_JSON_BYTES, chunkBytes: TRANSFER_CHUNK_BYTES } };
const spec = openApi(capabilities), ajv = new Ajv({ strictKeywords: false, allErrors: true });
ajv.addSchema(spec, 'api');
const validate = name => ajv.compile({ $ref: 'api#/components/schemas/' + name });
const commandValid = validate('Command'), uploadValid = validate('UploadRequest'), downloadValid = validate('DownloadManifest');
const revision = 'sha256:' + 'a'.repeat(64);

test('cover and metadata commands accept exactly one inline or owned staged byte source', () => {
  const target = { targetId: 10, expectedRevision: revision, mimeType: 'image/png', fileName: 'cover' };
  assert.equal(commandValid({ action: 'cover', ...target, bytesBase64: 'aGVsbG8=' }), true);
  assert.equal(commandValid({ action: 'cover', ...target, uploadId: randomUUID() }), true);
  assert.equal(commandValid({ action: 'cover', ...target }), false);
  assert.equal(commandValid({ action: 'cover', ...target, bytesBase64: 'aGVsbG8=', uploadId: randomUUID() }), false);
  const metadata = { action: 'metadata', targetId: 10, expectedRevision: revision, proposal: { fields: { Title: 'Approved' }, sources: [{ url: 'https://source.invalid', confidence: 1, note: 'Reviewed' }] } };
  assert.equal(commandValid({ ...metadata, cover: { mimeType: 'image/png', uploadId: randomUUID() } }), true);
  assert.equal(commandValid({ ...metadata, cover: { mimeType: 'image/png', bytesBase64: 'aGVsbG8=' } }), true);
  assert.equal(commandValid({ ...metadata, cover: { mimeType: 'image/png', uploadId: randomUUID(), bytesBase64: 'aGVsbG8=' } }), false);
});

test('staging schema distinguishes cover requirements/limits from owned ZIP references', () => {
  const common = { targetId: 10, size: 1, sha256: 'a'.repeat(64) };
  assert.equal(uploadValid({ kind: 'cover', ...common, mimeType: 'image/png', expectedRevision: revision }), true);
  assert.equal(uploadValid({ kind: 'cover', ...common, mimeType: 'image/png' }), false);
  assert.equal(uploadValid({ kind: 'cover', ...common, size: 10485761, mimeType: 'image/png', expectedRevision: revision }), false);
  assert.equal(uploadValid({ kind: 'zip', ...common, size: 67108864 }), true);
  assert.equal(uploadValid({ kind: 'zip', ...common, size: 67108865 }), false);
  assert.equal(uploadValid({ kind: 'zip', ...common, mimeType: 'image/png' }), false);
  const content = spec.paths['/exchange/{timelineId}/preview'].post.requestBody.content;
  assert.ok(content['application/zip']);
  const referenceValid = ajv.compile(content['application/json'].schema);
  assert.equal(referenceValid({ uploadId: randomUUID() }), true); assert.equal(referenceValid({ uploadId: randomUUID(), targetId: 10 }), false);
});

test('large binary and JSON successes advertise usable authenticated download manifests', () => {
  const download = { id: randomUUID(), size: 4194304, sha256: 'a'.repeat(64), chunkSize: TRANSFER_CHUNK_BYTES, chunks: 2, expiresAt: new Date().toISOString(), contentType: 'application/zip', status: 200, headers: { 'content-type': 'application/zip' } };
  assert.equal(downloadValid({ download }), true);
  assert.equal(downloadValid({ download: { ...download, chunkSize: 99 } }), false);
  assert.equal(downloadValid({ download: { ...download, sha256: 'wrong' } }), false);
  for(const route of ['/content/{id}/cover','/exchange/{timelineId}/export']) {
    const success=spec.paths[route].get.responses[200];
    assert.equal(success.content['application/json'].schema.$ref, '#/components/schemas/DownloadManifest');
  }
  assert.ok(spec.paths['/plans'].post.responses[200].content['application/json'].schema.anyOf.some(schema=>schema.$ref==='#/components/schemas/DownloadManifest'));
  assert.ok(spec.paths['/jobs/{id}'].get.responses[200].content['application/zip']);
  assert.ok(spec.paths['/plans/{id}/apply'].post.responses[207].content['application/json']);
});

test('effective path parameters and wire limits describe the actual API contract', () => {
  for(const [route,item] of Object.entries(spec.paths)) for(const method of ['get','post']) {
    const operation=item[method];if(!operation)continue;
    const effective=new Map([...(item.parameters||[]),...(operation.parameters||[])].map(parameter=>[parameter.in+':'+parameter.name,parameter]));
    for(const [,name] of route.matchAll(/\{([^}]+)\}/g)) { const parameter=effective.get('path:'+name);assert.equal(parameter.required,true);assert.ok(parameter.schema); }
  }
  assert.equal(spec.paths['/content/{id}'].parameters[0].schema.type,'integer');
  assert.equal(spec.paths['/jobs/{id}'].parameters[0].schema.format,'uuid');
  assert.equal(spec.paths['/uploads/{id}/chunks/{index}'].parameters[1].schema.minimum,0);
  assert.equal(spec.paths['/plans'].post.requestBody['x-max-bytes'],TRANSFER_JSON_BYTES);
  assert.equal(spec.paths['/uploads/{id}/chunks/{index}'].post.requestBody['x-max-bytes'],TRANSFER_CHUNK_BYTES);
  assert.equal(spec['x-timeline-limits'].inlineBytes,TRANSFER_INLINE_BYTES);
  assert.equal(spec.paths['/recovery'].post.requestBody.content['application/json'].schema.properties.stoppedRequestId.format,'uuid');
  assert.ok(spec.paths['/uploads'].post.responses[201]);
});

test('public cloud diagnostic refuses production, other previews and mismatched discovery', async () => {
  assert.equal(validatePreviewUrl('https://deploy-preview-53--timeline-theories.netlify.app/'),'https://deploy-preview-53--timeline-theories.netlify.app');
  for(const url of ['https://timeline-theories.netlify.app','https://deploy-preview-54--timeline-theories.netlify.app','http://deploy-preview-53--timeline-theories.netlify.app','https://deploy-preview-53--timeline-theories.netlify.app/other','https://deploy-preview-53--timeline-theories.netlify.app?redirect=x','https://owner:secret@deploy-preview-53--timeline-theories.netlify.app','https://deploy-preview-53--timeline-theories.netlify.app:8443','https://deploy-preview-53--timeline-theories.netlify.app.evil.invalid'])assert.throws(()=>validatePreviewUrl(url));
  const expected={repository:'https://plastice.sensenet.cloud',authority:'https://plastice-is.sensenet.cloud',project:'/Root/Content/timelines',version:'1',runtime:'Netlify Functions in the Timeline app',concurrency:{atomicBatch:false}};
  verifyBinding(expected);assert.throws(()=>verifyBinding({...expected,authority:'https://wrong.invalid'}));
  let requests=0;
  await assert.rejects(runCloudStateSmoke({url:'https://deploy-preview-53--timeline-theories.netlify.app',fetchImpl:async(url,options)=>{requests++;assert.equal(new Headers(options.headers).has('authorization'),false);assert.equal(new URL(url).pathname,'/api/v1/capabilities');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');return Response.json({...expected,project:'/Root/Content/wrong'});}}),/Discovery does not match/);
  assert.equal(requests,1);
});

test('public diagnostic polls only the fixed empty-JSON route and never sends or prints credentials', async () => {
  const capabilities={repository:'https://plastice.sensenet.cloud',authority:'https://plastice-is.sensenet.cloud',project:'/Root/Content/timelines',version:'1',runtime:'Netlify Functions in the Timeline app',concurrency:{atomicBatch:false}};
  let requests=0;
  const result=await runCloudStateSmoke({url:'https://deploy-preview-53--timeline-theories.netlify.app',fetchImpl:async(url,options)=>{
    requests++;const headers=new Headers(options.headers);assert.equal(headers.has('authorization'),false);assert.equal(headers.has('x-timeline-backend-auth'),false);assert.equal(headers.has('cookie'),false);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    if(requests===1){assert.equal(new URL(url).pathname,'/api/v1/capabilities');assert.equal(options.method,'GET');return Response.json(capabilities);}
    assert.equal(new URL(url).pathname,'/api/v1/__verification/storage');assert.equal(options.method,'POST');assert.equal(options.body,'{}');assert.deepEqual([...headers.keys()],['content-type']);
    if(requests===2)return Response.json({storageSelftest:{state:'running'},pending:true,senseNetRequests:0,repositoryWrites:0},{status:202});
    return Response.json({storageSelftest:{state:'completed',passed:true,checks:{firstWriteWinners:1,strongInitialRead:true,nonmatchingCasRejected:true,currentCasSucceeded:true,staleCasRejected:true,strongFinalRead:true,ownedCleanupVerified:true},unexpected:'private-response-must-not-be-dumped'},senseNetRequests:0,repositoryWrites:0});
  }});
  assert.equal(result.httpRequests,3);assert.equal(result.credentialsSent,false);assert.equal(result.senseNetRequests,0);assert.equal(result.repositoryWrites,0);
  assert.equal(JSON.stringify(result).includes('private-response-must-not-be-dumped'),false);
});
