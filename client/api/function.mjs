import { randomUUID } from 'node:crypto';
import { Store, assertUuid, hash } from './store.mjs';
import { Coordinator } from './coordinator.mjs';
import { MutationJournal } from './journal.mjs';
import { loadConfig } from './config.mjs';
import { authenticate, issueGrant, SCOPES } from './auth.mjs';
import { preview, apply, requireScope, receiptTargets } from './plans.mjs';
import { DomainError, assertId, assertObject, TYPES, FIELDS } from '../domain/content.mjs';
import { createProviderService } from './providers.mjs';
import { decodeArchive, encodeArchive } from './exchange.mjs';
import { entryFieldsFromRow } from '../domain/exchange.mjs';
import { openApi } from './openapi.mjs';
import { fetchPublicCover, coverOrigins } from './covers.mjs';
import { resolveProviderKeys } from './provider-secrets.mjs';
import { JobService } from './jobs.mjs';
import { TransferService, TRANSFER_JSON_BYTES, TRANSFER_CHUNK_BYTES } from './transfers.mjs';

const routes = ['capabilities','openapi.json','schemas/{type}','lookup','snapshots','content/{id}','content/{id}/cover','timelines','media','books','entries','plans','plans/{id}/apply','recovery','providers/books/search','providers/books/details','providers/media/lookup','providers/trakt/list','exchange/{timelineId}/export','exchange/{timelineId}/preview','grants','grants/{id}/revoke','jobs/{id}','jobs/{id}/cancel','uploads','uploads/{id}/chunks/{index}','uploads/{id}/complete','downloads/{id}/chunks/{index}'];
const longRoute = (method, route) => method === 'POST' && (route === 'plans' || /^plans\/[0-9a-f-]{36}\/apply$/.test(route) || route.startsWith('providers/') || /^exchange\/\d+\/preview$/.test(route)) || method === 'GET' && /^exchange\/\d+\/export$/.test(route);
const descriptor = (status, value, readTargets = []) => ({ status, headers: {'Content-Type':'application/json; charset=utf-8'}, body: Buffer.from(JSON.stringify(value)), readTargets });
function failure(error, requestId) {
  const recognized = error instanceof DomainError || error?.code?.startsWith('provider_') || error?.code === 'invalid_provider_input';
  const status = recognized ? error.status || 500 : 500;
  return descriptor(status, { error: { code: recognized ? error.code : 'internal_error', message: status === 500 ? 'Application API operation failed.' : error.message, details: error instanceof DomainError ? error.details : undefined, source: error.source, retryAfter: error.retryAfter }, requestId });
}
async function bytes(request, limit = TRANSFER_JSON_BYTES) {
  if (Number(request.headers.get('content-length')) > limit) throw new DomainError('input_limit','Request exceeds the app wire limit. Use owned upload chunks.',413);
  const reader = request.body?.getReader(), parts = []; let size = 0;
  if (!reader) return Buffer.alloc(0);
  try { for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); throw new DomainError('input_limit','Request exceeds the app wire limit. Use owned upload chunks.',413); } parts.push(Buffer.from(value)); } }
  finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}
async function bodyJson(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('content_type','Use application/json.',415);
  let input; try { input = JSON.parse((await bytes(request)).toString()); } catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('invalid_json','Invalid JSON body.'); }
  assertObject(input); return input;
}
function normalized(request, config, background = false) {
  const incoming = new URL(request.url), url = new URL(config.frontendOrigin);
  url.pathname = background ? '/.netlify/functions/native-api-background' : incoming.pathname.replace(/^\/\.netlify\/functions\/native-api\/(?:v1\/)?/, '/api/v1/');
  url.search = incoming.search;
  return new Request(url, { method: request.method, headers: request.headers, ...(request.body ? { body: request.body, duplex: 'half' } : {}) });
}
function nodeHeaders(request) { return {headers:Object.fromEntries(request.headers)}; }
function capabilities(config) {
  return { version:'1', basePath:'/api/v1', runtime:'Netlify Functions in the Timeline app', repository:config.repositoryUrl, authority:config.authority, project:config.projectRoot, readOnly:config.readOnly, backendProtocolRequired:'gateway-coordinated-v1', backendAvailability:'Standard SenseNet HTTP API; verified on exact requests.',
    authentication:{scheme:'Bearer',scopedCredentials:true,browserSession:'Backend-validated user credential with the configured app Origin or X-Timeline-Client-Origin.',maxLifetimeSeconds:2592000,bindingHeaders:['X-Timeline-Repository','X-Timeline-Authority','X-Timeline-Project']},scopes:SCOPES,operations:routes,
    limits:{pageSize:100,planTargets:5000,planLifetimeSeconds:900,jsonBytes:TRANSFER_JSON_BYTES,logicalPlanJsonBytes:20*1024*1024,chunkBytes:TRANSFER_CHUNK_BYTES,coverBytes:10*1024*1024,zipBytes:64*1024*1024,backgroundSeconds:900},
    providers:{environment:createProviderService({keys:{omdb:process.env.OMDB_API_KEY,tmdb:process.env.TMDB_API_KEY,trakt:process.env.TRAKT_API_KEY,googlebooks:process.env.GOOGLE_BOOKS_API_KEY}}).status(),repositoryKeyStore:config.providerKeyPaths,keyAvailability:'Checked privately using the caller credential.'},
    concurrency:{protocol:'gateway-coordinated-v1',revision:'sha256 snapshot hash',coordinator:'Strong Netlify app Blobs reads and conditional ETag writes; each invocation has unique ownership.',receipts:'Private durable intent and result records. Uncertain writes are reconciled without redispatch.',stoppedInvocation:'Original backend identity must confirm the exact stopped request ID; no automatic takeover.',externalRepositoryWriters:'Outside the application coordination boundary.',atomicBatch:false,atomicFieldsAndCover:false},
    inventory:{configured:!!config.inventoryCredential,requiredFor:['create/rename collision preflight','full order','timeline deletion','media reference preflight'],policy:'Explicit read-only identity. Mutations and public snapshots always use caller ACL.'},exchange:'19-column timeline_data.tsv plus covers; references require existing local media IDs.' };
}
async function readCover(context, media) {
  await context.check(); await context.repo.assert([{target:media.Id,action:'read'}]);
  if (!media.CoverImageBin || !(Number(media.CoverImageBin.Size)>0) && !['image/png','image/jpeg','image/webp'].includes(media.CoverImageBin.ContentType)) {
    if (!media.CoverImageUrl) return null;
    return fetchPublicCover(media.CoverImageUrl,{origins:coverOrigins(process.env.TIMELINE_COVER_ORIGINS),beforeFetch:async()=>{await context.check();await context.repo.assert([{target:media.Id,action:'read'}]);}});
  }
  const result = await context.repo.request(context.repo.config.repositoryUrl+'/binaryhandler.ashx?'+new URLSearchParams({nodeid:String(media.Id),propertyname:'CoverImageBin'}),{maxBytes:10*1024*1024});
  const contentType=result.contentType?.split(';')[0];
  return result.bytes.length && ['image/png','image/jpeg','image/webp'].includes(contentType) ? {data:result.bytes,contentType} : null;
}
export function createFunctionApp(config, { store = new Store(config), coordinator = new Coordinator(config), invoke } = {}) {
  const transfers = new TransferService(config,store), jobs = new JobService(config,{store,invoke,prepareResponse:(result,context)=>transfers.prepareResponse(result,context)});
  async function recovery(request, context) {
    const input=await bodyJson(request);
    if (Object.keys(input).some(k=>!['planId','stoppedRequestId'].includes(k)) || typeof input.planId !== 'string') throw new DomainError('invalid_input','Recovery requires the original planId and optionally the exact confirmed stoppedRequestId.');
    const plan=await store.recoveryPlan(input.planId,context.identity.Id);
    if (input.stoppedRequestId !== undefined) {
      const held=await coordinator.inspect();
      if (held.owner?.planId !== plan.id) throw new DomainError('coordinator_owner_conflict','The stopped invocation belongs to another plan.',409);
      await context.check(); await coordinator.releaseAbandoned(input.stoppedRequestId,context.identity.Id);
    }
    return coordinator.run(async()=>{
      const journal=new MutationJournal(store,plan.principal,context.repo),operations=[],readTargets=new Set();
      for (const step of plan.steps) {
        await context.check(); if (!await journal.row(step.payload)) continue;
        try { const receipt=await journal.receipt(step.payload);if(receipt.found)for(const target of await receiptTargets(context,{steps:[step]},{completed:[{index:0,result:receipt.result||receipt.failure}]}))readTargets.add(target);operations.push({operationId:step.payload.operationId,confirmed:receipt.found,ok:receipt.ok!==false,result:receipt.result,failure:receipt.failure}); }
        catch(error) { if (!(error instanceof DomainError)) throw error; operations.push({operationId:step.payload.operationId,confirmed:false,error:{code:error.code,message:error.message,details:error.details}}); }
      }
      return descriptor(200,{planId:plan.id,repositoryWrites:0,operations,pending:operations.some(op=>!op.confirmed),policy:'Read-only reconciliation with current backend identity and ACL; no expired grant or plan redispatches a write.'},[...readTargets]);
    },{requestId:randomUUID(),identity:context.identity.Id,principal:context.principal,planId:plan.id});
  }
  async function execute(request, context, job) {
    const url=new URL(request.url), route=url.pathname.slice('/api/v1/'.length), method=request.method;
    if (job) await job.assertOwner();
    if (route==='plans' && method==='POST') { const input=await bodyJson(request); const plan=await preview(context,{...input,commands:await transfers.hydrateCommands(context,input.commands)},store); return descriptor(200,plan,plan.targets); }
    const applyRoute=route.match(/^plans\/([0-9a-f-]{36})\/apply$/);
    if (applyRoute && method==='POST') {
      if (Object.keys(await bodyJson(request)).length) throw new DomainError('invalid_input','Apply accepts only the saved plan and Idempotency-Key.');
      return coordinator.run(async guard=>{
        context.repo.beforeWrite=async()=>{await guard.assertOwner();if(job)await job.assertOwner();else await context.check();await guard.assertOwner();if(job)await job.checkCancelled();};
        const result=await apply(context,applyRoute[1],request.headers.get('idempotency-key'),store);
        const plan=await store.plan(applyRoute[1],context.principal),targets=await receiptTargets(context,plan,result);
        return descriptor(result.ok?200:result.completed.length?207:result.error?.status || (result.conflicted.length?409:403),result,targets);
      },{requestId:randomUUID(),identity:context.identity.Id,principal:context.principal,planId:applyRoute[1],jobId:job?.id,waitMs:5000});
    }
    const schema=route.match(/^schemas\/([A-Za-z]+)$/);
    if (schema && method==='GET') {
      requireScope(context,'content:read'); const type=schema[1]; if (!TYPES.includes(type)) throw new DomainError('invalid_type','Unsupported application schema.');
      await context.repo.assert([{target:type==='Timeline'||type==='TimelineEntry'?context.repo.paths.timelines:context.repo.paths.media,action:'read'}]);
      const actual=await context.repo.schemaFor(type),fields=FIELDS[type].map(name=>{const field=actual.FieldSettings.find(f=>f.Name===name);return {name,supported:!!field,writable:field?.ReadOnly===false,required:field?.Compulsory===true,...(field?.Type==='ChoiceFieldSetting'?{choices:field.Options.filter(o=>o.Enabled!==false).map(o=>o.Value),multiple:field.AllowMultiple===true}:{})};});
      return descriptor(200,{data:{type,fields,binaryCover:['Timeline','MediaItem','BookMediaItem'].includes(type),policy:'Only supported writable fields may appear in a plan.'}});
    }
    const content=route.match(/^content\/(\d+)$/),cover=route.match(/^content\/(\d+)\/cover$/);
    if (content && method==='GET') { requireScope(context,'content:read'); const data=await context.repo.read(assertId(Number(content[1])));return descriptor(200,{data},[data.Id]); }
    if (cover && method==='GET') { requireScope(context,'content:read');const media=await context.repo.read(assertId(Number(cover[1]))),binary=await readCover(context,media);if(!binary)throw new DomainError('cover_unavailable','Binary cover is unavailable.',404);return {status:200,headers:{'Content-Type':binary.contentType},body:binary.data,readTargets:[media.Id]}; }
    if (route==='lookup' && method==='POST') { requireScope(context,'content:read');const input=await bodyJson(request);if(Object.keys(input).some(k=>!['target','parent'].includes(k)))throw new DomainError('invalid_input','Lookup accepts target and optional parent.');const data=await context.repo.read(input.target,{parent:input.parent===true});return descriptor(200,{data},[data.Id]); }
    if (route==='snapshots' && method==='POST') { requireScope(context,'content:read');const input=await bodyJson(request);if(!Array.isArray(input.ids)||input.ids.length>100||Object.keys(input).some(k=>k!=='ids'))throw new DomainError('invalid_input','Snapshot batch accepts at most 100 content IDs.');const data=[];for(const id of input.ids)data.push(await context.repo.read(assertId(id)));return descriptor(200,{data},data.map(row=>row.Id)); }
    const type={timelines:'Timeline',media:'MediaItem',books:'BookMediaItem',entries:'TimelineEntry'}[route];
    if (type && method==='GET') { requireScope(context,'content:read');for(const key of url.searchParams.keys())if(!['skip','top','search','timelineId','includeHidden'].includes(key))throw new DomainError('invalid_query','Unknown list parameter.');const data=await context.repo.list(type,{skip:Number(url.searchParams.get('skip')||0),top:Number(url.searchParams.get('top')||50),search:url.searchParams.get('search')||'',parentId:url.searchParams.has('timelineId')?Number(url.searchParams.get('timelineId')):undefined,includeHidden:url.searchParams.get('includeHidden')==='true'});return descriptor(200,data,data.items.map(row=>row.Id)); }
    if (route.startsWith('providers/') && method==='POST') {
      requireScope(context,'providers:read');const input=await bodyJson(request),operation={'providers/books/search':'books.search','providers/books/details':'books.details','providers/media/lookup':'media.lookup','providers/trakt/list':'trakt.list'}[route];
      if(!operation)throw new DomainError('route_unavailable','Provider route not found.',404);
      const ops=[{target:context.repo.paths.media,action:'read'}],mediaRoot=await context.repo.read(context.repo.paths.media,{parent:true}),readTargets=[mediaRoot.Id];
      if(operation==='media.lookup') { const media=await context.repo.read(assertId(input.mediaItem?.Id),{expectedType:'MediaItem'});input.mediaItem=Object.fromEntries(['Id','DisplayName','Title','Subtitle','MediaType','ExternalLinks'].map(field=>[field,field==='MediaType'&&Array.isArray(media[field])?media[field][0]:media[field]]).filter(([,v])=>v!==null&&v!==undefined));ops.push({target:media.Id,action:'update'});requireScope(context,'metadata:write');readTargets.push(media.Id); }
      if(operation==='trakt.list') { requireScope(context,'entries:write');requireScope(context,'media:write');ops.push({target:context.repo.paths.media,action:'create',type:'MediaItem'}); }
      const beforeFetch=async()=>{if(job)await job.assertOwner();else await context.check();await context.repo.assert(ops);};await beforeFetch();
      const service=createProviderService({keys:await resolveProviderKeys(context,config,operation,input,beforeFetch)});
      return descriptor(200,{data:await service.execute(operation,input,{beforeFetch})},readTargets);
    }
    const exchange=route.match(/^exchange\/(\d+)\/(export|preview)$/);
    if (exchange && method===(exchange[2]==='export'?'GET':'POST')) {
      const operation=exchange[2];requireScope(context,operation==='export'?'exchange:read':'exchange:write');
      const timeline=await context.repo.read(assertId(Number(exchange[1])),{expectedType:'Timeline'}),entries=await context.repo.all('TimelineEntry',{parentId:timeline.Id,includeHidden:operation!=='export'});
      if(operation==='export') {
        const cache=new Map();for(const entry of entries){if(!entry.MediaItem)throw new DomainError('reference_unavailable','Export needs readable local media references.',403);if(!cache.has(entry.MediaItem))cache.set(entry.MediaItem,await context.repo.read(entry.MediaItem,{expectedType:'MediaItem'}));}
        await context.check();const full=entries.sort((a,b)=>a.Position-b.Position||a.Id-b.Id).map(entry=>({...entry,mediaItem:cache.get(entry.MediaItem)}));
        const archive=await encodeArchive(timeline,full,async media=>{try{return await readCover(context,media);}catch(error){if(error?.code?.startsWith('cover_')||error?.code==='invalid_cover')return null;throw error;}});
        return {status:200,headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="timeline.zip"','X-Timeline-Skipped-Covers':String(archive.skippedImagesCount)},body:archive.buffer,readTargets:[timeline.Id,...entries.map(e=>e.Id),...cache.keys()]};
      }
      let archiveBytes;
      if(request.headers.get('content-type')?.startsWith('application/json')) { const input=await bodyJson(request);if(Object.keys(input).some(k=>k!=='uploadId')||typeof input.uploadId!=='string')throw new DomainError('invalid_input','Archive preview accepts one completed uploadId.');archiveBytes=await transfers.loadUpload(context,input.uploadId,{kind:'zip',targetId:timeline.Id}); }
      else if(request.headers.get('content-type')?.startsWith('application/zip'))archiveBytes=await bytes(request);
      else throw new DomainError('content_type','Use application/zip or a completed owned ZIP upload.',415);
      const archive=await decodeArchive(archiveBytes),byName=new Map(entries.map(e=>[e.Name,e])),commands=[],covers=new Map();
      for(const row of archive.entries) {
        const media=await context.repo.read(assertId(Number(row.mediaId)),{expectedType:'MediaItem'}),previous=byName.get(row.entryName);
        if(previous&&previous.MediaItem!==media.Id)throw new DomainError('reference_conflict','Archive media differs from the existing occurrence.',409);
        const fields=entryFieldsFromRow(row,{displayName:media.Title||media.DisplayName});commands.push(previous?{action:'update',targetId:previous.Id,expectedRevision:previous.revision,fields}:{action:'create',type:'TimelineEntry',parentId:timeline.Id,fields});
        if(row.coverImageFilename){const data=archive.covers.get(row.coverImageFilename),base64=data.toString('base64');if(covers.has(media.Id)&&covers.get(media.Id)!==base64)throw new DomainError('cover_conflict','Archive has different covers for the same shared media.',409);if(!covers.has(media.Id)){commands.push({action:'cover',targetId:media.Id,expectedRevision:media.revision,bytesBase64:base64,mimeType:data[0]===137?'image/png':data[0]===255?'image/jpeg':'image/webp',fileName:row.coverImageFilename});covers.set(media.Id,base64);}}
      }
      const plan=await preview(context,{commands},store);return descriptor(200,{...plan,archive:archive.stats},plan.targets);
    }
    throw new DomainError('route_unavailable','Application route not found.',404);
  }
  // Preview-only platform verification writes one owned UUID of app metadata;
  // there is no arbitrary storage key, repository write or administrator proxy.
  async function verifyState(request, context, id) {
    if(!config.local && config.deployContext!=='deploy-preview')throw new DomainError('route_unavailable','Application route not found.',404);
    assertUuid(id);await context.check();await context.repo.assert([{target:context.repo.paths.root,action:'read'}]);
    const input=await bodyJson(request),key=store.prefix+'verification/'+hash(context.principal)+'/'+id;
    if(Object.keys(input).some(k=>!['phase','value','etag'].includes(k))||!['new','replace','read','delete'].includes(input.phase))throw new DomainError('invalid_input','Invalid bounded verification phase.');
    if(input.phase==='delete'){await store.blobs.delete(key);return descriptor(200,{deleted:true,repositoryWrites:0});}
    if(input.phase==='read'){const result=await store.blobs.getWithMetadata(key,{type:'json',consistency:'strong'});return descriptor(200,{exists:!!result,value:result?.data.value,etag:result?.etag,repositoryWrites:0});}
    if(!['A','B','C'].includes(input.value)||input.phase==='replace'&&(typeof input.etag!=='string'||!input.etag.trim()||input.etag.length>512))throw new DomainError('invalid_input','Verification accepts bounded values and an ETag.');
    const result=await store.blobs.setJSON(key,{value:input.value},input.phase==='new'?{onlyIfNew:true}:{onlyIfMatch:input.etag});
    return descriptor(200,{modified:result.modified,etag:result.etag,repositoryWrites:0});
  }
  async function handle(request, background=false) {
    const requestId=randomUUID();let originHeader=request.headers.get('origin');
    const headers={'X-Request-Id':requestId,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    try {
      request=normalized(request,config,background);const url=new URL(request.url),route=url.pathname.slice('/api/v1/'.length),method=request.method;
      if(originHeader && originHeader!==config.frontendOrigin)throw new DomainError('origin_denied','App origin is not allowed.',403);
      if(originHeader===config.frontendOrigin)Object.assign(headers,{'Access-Control-Allow-Origin':config.frontendOrigin,Vary:'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type,Idempotency-Key,X-Timeline-Repository,X-Timeline-Authority,X-Timeline-Project,X-Timeline-Backend-Auth,X-Timeline-Client-Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});
      if(!background && (!url.pathname.startsWith('/api/v1/')||url.pathname.includes('//')))throw new DomainError('route_unavailable','Application route not found.',404);
      if(method==='OPTIONS')return new Response(null,{status:204,headers});
      if(!background && method==='GET' && ['capabilities','openapi.json'].includes(route)){const value=capabilities(config);return new Response(JSON.stringify(route==='capabilities'?value:openApi(value)),{headers:{...headers,'Content-Type':'application/json'}});}
      const revoke=route.match(/^grants\/([0-9a-f-]{36})\/revoke$/),verification=route.match(/^__verification\/state\/([0-9a-f-]{36})$/);
      const publicRead=method==='GET' && (['timelines','media','books','entries'].includes(route)||/^content\/\d+(\/cover)?$/.test(route)||/^downloads\/[0-9a-f-]{36}\/chunks\/\d+$/.test(route))||method==='POST'&&['lookup','snapshots'].includes(route);
      const context=await authenticate(nodeHeaders(request),config,store,{session:['grants','recovery'].includes(route)||!!verification||!!revoke&&!request.headers.get('authorization')?.startsWith('Bearer tta_'),anonymous:publicRead});
      let response;
      if(background)response=await jobs.run(request,context,({request,context,job})=>execute(request,context,job));
      else if(verification && method==='POST')response=await transfers.prepareResponse(await verifyState(request,context,verification[1]),context);
      else if(revoke && method==='POST'){if(Object.keys(await bodyJson(request)).length)throw new DomainError('invalid_input','Revoke accepts an empty object.');await context.check();if(context.grant&&revoke[1]!==context.grant.id)throw new DomainError('grant_admin_denied','A delegated grant may revoke only itself.',403);if(!await store.revoke(revoke[1],context.identity.Id))throw new DomainError('grant_unavailable','Grant is unavailable for this identity.',404);await store.audit(context.principal,'grant','revoked',[]);response=new Response(JSON.stringify({revoked:true}),{headers:{'Content-Type':'application/json'}});}
      else if(route==='grants' && method==='POST')response=await transfers.prepareResponse(descriptor(201,await issueGrant(context,await bodyJson(request),config,store)),context);
      else if(route==='recovery' && method==='POST')response=await transfers.prepareResponse(await recovery(request,context),context);
      else if(/^jobs\/[0-9a-f-]{36}(\/cancel)?$/.test(route)){const parts=route.split('/');if(parts.length===2&&method==='GET')response=await jobs.status(parts[1],context);else if(parts[2]==='cancel'&&method==='POST'){if(Object.keys(await bodyJson(request)).length)throw new DomainError('invalid_input','Cancellation accepts an empty object.');response=await jobs.cancel(parts[1],context);}else throw new DomainError('route_unavailable','Job route not found.',404);}
      else if(longRoute(method,route))response=await jobs.enqueue(request,context,await bytes(request),{requestId});
      else response=await transfers.handle(request,context) || await transfers.prepareResponse(await execute(request,context),context);
      for(const [name,value] of Object.entries(headers))response.headers.set(name,value);return response;
    } catch(error){const result=failure(error,requestId);return new Response(result.body,{status:result.status,headers:{...result.headers,...headers}});}
  }
  return {handleRequest:request=>handle(request),handleBackgroundRequest:request=>handle(request,true),store,coordinator,jobs,transfers};
}
async function invoke(request, background, runtimeContext) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),background?895000:55000);
  try { const config={...loadConfig({runtimeContext,requestUrl:request.url}),signal:controller.signal};const app=createFunctionApp(config);return await (background?app.handleBackgroundRequest(request):app.handleRequest(request)); }
  catch(error){const result=failure(error,randomUUID());return new Response(result.body,{status:result.status,headers:result.headers});}
  finally { clearTimeout(timeout); }
}
export const handleRequest=(request,context)=>invoke(request,false,context);
export const handleBackgroundRequest=(request,context)=>invoke(request,true,context);
