import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { Coordinator } from './coordinator.mjs';
import { MutationJournal } from './journal.mjs';
import { loadConfig } from './config.mjs';
import { authenticate, issueGrant, SCOPES } from './auth.mjs';
import { preview, apply, requireScope } from './plans.mjs';
import { DomainError, assertId, assertObject, TYPES, FIELDS } from '../client/domain/content.mjs';
import { createProviderService } from './providers.mjs';
import { decodeArchive, encodeArchive } from './exchange.mjs';
import { entryFieldsFromRow } from '../client/domain/exchange.mjs';
import { openApi } from './openapi.mjs';
import { fetchPublicCover, coverOrigins } from './covers.mjs';
import { productionReadOnlyKeySource, resolveProviderKeys } from './provider-secrets.mjs';

const routes = ['capabilities','openapi.json','schemas/{type}','lookup','snapshots','content/{id}','content/{id}/cover','timelines','media','books','entries','plans','plans/{id}/apply','recovery','providers/books/search','providers/books/details','providers/media/lookup','providers/trakt/list','exchange/{timelineId}/export','exchange/{timelineId}/preview','grants','grants/{id}/revoke'];
export function createApp(config, { store = new Store(config.dataDir), coordinator = new Coordinator(config), providers = createProviderService({ keys: { omdb: process.env.OMDB_API_KEY, tmdb: process.env.TMDB_API_KEY, trakt: process.env.TRAKT_API_KEY, googlebooks: process.env.GOOGLE_BOOKS_API_KEY } }) } = {}) {
  const capabilities = { version: '1', basePath: '/api/v1', repository: config.repositoryUrl, authority: config.authority, project: config.projectRoot, readOnly: config.readOnly, backendProtocolRequired:'gateway-coordinated-v1',backendAvailability:'Standard SenseNet HTTP API; verified on exact requests.', authentication: { scheme: 'Bearer', scopedCredentials: true, browserSession:'Backend-validated user token with matching frontend Origin or X-Timeline-Client-Origin; these are routing constraints, not authentication.',maxLifetimeSeconds: 2592000, bindingHeaders: ['X-Timeline-Repository','X-Timeline-Authority','X-Timeline-Project'] }, scopes: SCOPES, operations: routes, limits: { pageSize: 100, planTargets: 5000, planLifetimeSeconds: 900, jsonBytes: 20 * 1024 * 1024, coverBytes: 10 * 1024 * 1024, zipBytes: 64 * 1024 * 1024 }, providers: {environment:providers.status(),repositoryKeyStore:config.providerKeyPaths,keyAvailability:'Checked server-side with the caller credential or the explicitly configured test secret reader.'}, concurrency: {protocol:'gateway-coordinated-v1',revision:'sha256 snapshot hash',coordinator:'Persistent SQLite transaction lock shared by all Timeline UI/native writers and gateway processes on one host.',receipts:'Durable gateway intents/results; uncertain writes are reconciled or fail closed without redispatch.',externalRepositoryWriters:'Outside the application coordination boundary.',atomicBatch:false,atomicFieldsAndCover:false},inventory:{configured:!!config.inventoryCredential,requiredFor:['create/rename collision preflight','full order','timeline deletion','media reference preflight'],policy:'Explicit project-wide read-only identity; mutations and public snapshots always use caller ACL.'}, exchange: '19-column timeline_data.tsv plus covers; references require existing local media IDs.' };
  const handler = async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id',requestId); res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff');
    try {
      const url = new URL(req.url,'https://gateway.invalid');
      if (!url.pathname.startsWith('/api/v1/') || url.pathname.includes('//')) throw new DomainError('route_unavailable','Application route not found.',404);
      if (req.headers.origin && req.headers.origin !== config.frontendOrigin) throw new DomainError('origin_denied','Frontend origin is not allowed.',403);
      if (req.headers.origin === config.frontendOrigin) {
        res.setHeader('Access-Control-Allow-Origin',config.frontendOrigin); res.setHeader('Vary','Origin');
        res.setHeader('Access-Control-Allow-Headers','Authorization,Content-Type,Idempotency-Key,X-Timeline-Repository,X-Timeline-Authority,X-Timeline-Project,X-Timeline-Backend-Auth,X-Timeline-Client-Origin');
        res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const route = url.pathname.slice('/api/v1/'.length);
      if (req.method === 'GET' && route === 'capabilities') { return json(res,200,capabilities); }
      if (req.method === 'GET' && route === 'openapi.json') { return json(res,200,openApi(capabilities)); }
      const publicRead = req.method === 'GET' && (['timelines','media','books','entries'].includes(route) || /^content\/\d+(\/cover)?$/.test(route)) || req.method === 'POST' && ['lookup','snapshots'].includes(route);
      const revoke = route.match(/^grants\/([0-9a-f-]{36})\/revoke$/);
      const ownerRevoke=!!revoke&&!req.headers.authorization?.startsWith('Bearer tta_');
      const context = await authenticate(req,config,store,{session: ['grants','recovery'].includes(route)||ownerRevoke,anonymous: publicRead});
      // Credential revocation commits in the grant DB without waiting for a
      // long content batch's coordinator lock. Every repository write checks
      // this state again immediately before its individual dispatch.
      if (revoke && req.method === 'POST') { await context.check(); if(context.grant&&revoke[1]!==context.grant.id)throw new DomainError('grant_admin_denied','A delegated grant may revoke only itself; other grants require the current backend owner credential.',403);if (!store.revoke(revoke[1],context.identity.Id)) throw new DomainError('grant_unavailable','Grant is unavailable for this identity.',404); store.audit(context.principal,'grant','revoked',[]); return json(res,200,{revoked:true}); }
      return await coordinator.run(async()=>{
      if (route === 'grants' && req.method === 'POST') return json(res,201,await issueGrant(context,await bodyJson(req),config,store));
      if(route==='recovery'&&req.method==='POST') {
        const input=await bodyJson(req);if(Object.keys(input).some(k=>k!=='planId')||typeof input.planId!=='string')throw new DomainError('invalid_input','Recovery accepts the original planId.');
        const plan=store.recoveryPlan(input.planId,context.identity.Id),journal=new MutationJournal(store,plan.principal,context.repo),operations=[];
        for(const step of plan.steps){await context.check();if(!journal.row(step.payload))continue;try{const receipt=await journal.receipt(step.payload);operations.push({operationId:step.payload.operationId,confirmed:receipt.found,ok:receipt.ok!==false,result:receipt.result,failure:receipt.failure});}catch(error){if(!(error instanceof DomainError))throw error;operations.push({operationId:step.payload.operationId,confirmed:false,error:{code:error.code,message:error.message,details:error.details}});}}
        return json(res,200,{planId:plan.id,repositoryWrites:0,operations,pending:operations.some(operation=>!operation.confirmed),policy:'Read-only reconciliation under the current backend identity; no expired grant or plan can redispatch a write.'});
      }
      if (route === 'plans' && req.method === 'POST') return json(res,200,await preview(context,await bodyJson(req),store));
      const schemaRoute=route.match(/^schemas\/([A-Za-z]+)$/);
      if(schemaRoute&&req.method==='GET') {
        requireScope(context,'content:read');const type=schemaRoute[1];if(!TYPES.includes(type))throw new DomainError('invalid_type','Unsupported application schema.');
        await context.repo.assert([{target:type==='Timeline'||type==='TimelineEntry'?context.repo.paths.timelines:context.repo.paths.media,action:'read'}]);
        const schema=await context.repo.schemaFor(type),fields=FIELDS[type].map(name=>{const field=schema.FieldSettings.find(field=>field.Name===name);return {name,supported:!!field,writable:field?.ReadOnly===false,required:field?.Compulsory===true,...(field?.Type==='ChoiceFieldSetting'?{choices:field.Options.filter(option=>option.Enabled!==false).map(option=>option.Value),multiple:field.AllowMultiple===true}:{})};});
        return json(res,200,{data:{type,fields,binaryCover:['Timeline','MediaItem','BookMediaItem'].includes(type),policy:'Only actual supported writable fields may appear in a plan. Unsupported optional fields are omitted from read snapshots.'}});
      }
      const applyRoute = route.match(/^plans\/([0-9a-f-]{36})\/apply$/);
      if (applyRoute && req.method === 'POST') {
        const input = await bodyJson(req); if (Object.keys(input).length) throw new DomainError('invalid_input','Apply accepts only the saved plan and Idempotency-Key.');
        const result = await apply(context,applyRoute[1],req.headers['idempotency-key'],store);
        return json(res,result.ok ? 200 : result.completed.length ? 207 : result.error?.status|| (result.conflicted.length ? 409 : 403),result);
      }
      const content = route.match(/^content\/(\d+)$/);
      if (content && req.method === 'GET') { requireScope(context,'content:read'); return json(res,200,{data:await context.repo.read(assertId(Number(content[1])))}); }
      const cover = route.match(/^content\/(\d+)\/cover$/);
      if (cover && req.method === 'GET') {
        requireScope(context,'content:read'); const media = await context.repo.read(assertId(Number(cover[1])));
        const binary = await readCover(context,media);
        if (!binary) throw new DomainError('cover_unavailable','Binary cover is unavailable.',404);
        res.writeHead(200,{'Content-Type':binary.contentType}); res.end(binary.data); return;
      }
      if (route === 'lookup' && req.method === 'POST') {
        requireScope(context,'content:read'); const input = await bodyJson(req); assertObject(input);
        if (Object.keys(input).some(k=>!['target','parent'].includes(k))) throw new DomainError('invalid_input','Lookup accepts target and optional parent.');
        return json(res,200,{data:await context.repo.read(input.target,{parent:input.parent === true})});
      }
      if (route === 'snapshots' && req.method === 'POST') {
        requireScope(context,'content:read'); const input = await bodyJson(req);
        if (!Array.isArray(input.ids) || input.ids.length > 100 || Object.keys(input).some(k=>k!=='ids')) throw new DomainError('invalid_input','Snapshot batch accepts at most 100 content IDs.');
        const data = []; for (const id of input.ids) data.push(await context.repo.read(assertId(id))); return json(res,200,{data});
      }
      const type = {timelines:'Timeline',media:'MediaItem',books:'BookMediaItem',entries:'TimelineEntry'}[route];
      if (type && req.method === 'GET') {
        requireScope(context,'content:read');
        for (const key of url.searchParams.keys()) if (!['skip','top','search','timelineId','includeHidden'].includes(key)) throw new DomainError('invalid_query','Unknown list parameter.');
        return json(res,200,await context.repo.list(type,{skip:Number(url.searchParams.get('skip') || 0),top:Number(url.searchParams.get('top') || 50),search:url.searchParams.get('search') || '',parentId:url.searchParams.has('timelineId') ? Number(url.searchParams.get('timelineId')) : undefined,includeHidden:url.searchParams.get('includeHidden') === 'true'}));
      }
      if (route.startsWith('providers/') && req.method === 'POST') {
        requireScope(context,'providers:read'); const input = await bodyJson(req);
        const operation = {'providers/books/search':'books.search','providers/books/details':'books.details','providers/media/lookup':'media.lookup','providers/trakt/list':'trakt.list'}[route];
        if (!operation) throw new DomainError('route_unavailable','Provider route not found.',404);
        const ops = [{target:context.repo.paths.media,action:'read'}];
        if (operation === 'media.lookup') {
          const media = await context.repo.read(assertId(input.mediaItem?.Id),{expectedType:'MediaItem'});
          // Caller-supplied identity metadata cannot redirect provider lookup.
          input.mediaItem = Object.fromEntries(['Id','DisplayName','Title','Subtitle','MediaType','ExternalLinks'].map(field=>[field,field==='MediaType'&&Array.isArray(media[field])?media[field][0]:media[field]]).filter(([,value])=>value!==null&&value!==undefined));
          ops.push({target:media.Id,action:'update'}); requireScope(context,'metadata:write');
        }
        if (operation === 'trakt.list') {
          requireScope(context,'entries:write'); requireScope(context,'media:write');
          ops.push({target:context.repo.paths.media,action:'create',type:'MediaItem'});
        }
        const beforeFetch = async () => { await context.check(); await context.repo.assert(ops); };
        await beforeFetch();
        const service=createProviderService({keys:await resolveProviderKeys(context,config,operation,input,beforeFetch)});
        return json(res,200,{data:await service.execute(operation,input,{beforeFetch})});
      }
      const exchange = route.match(/^exchange\/(\d+)\/(export|preview)$/);
      if (exchange && req.method === (exchange[2] === 'export' ? 'GET' : 'POST')) {
        return await exchangeRoute(context,Number(exchange[1]),exchange[2],req,res,store);
      }
      throw new DomainError('route_unavailable','Application route not found.',404);
      });
    } catch (error) {
      const status = error instanceof DomainError || error?.code?.startsWith('provider_') || error?.code === 'invalid_provider_input' ? error.status || 500 : 500;
      json(res,status,{error:{code:error.code || 'internal_error',message:status === 500 ? 'Gateway operation failed.' : error.message,details:error instanceof DomainError ? error.details : undefined,source:error.source,retryAfter:error.retryAfter},requestId});
    }
  };
  const server = https.createServer({key:config.key,cert:config.cert,maxHeaderSize:16384},handler);
  server.requestTimeout=120000; server.headersTimeout=15000;
  return { server, store, coordinator, capabilities };
}

function json(res,status,value) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(value)); }
async function bytes(req,limit) {
  if (Number(req.headers['content-length']) > limit) throw new DomainError('input_limit','Request exceeds the byte limit.',413);
  const chunks=[];let size=0;
  for await (const chunk of req) {size+=chunk.length;if(size>limit)throw new DomainError('input_limit','Request exceeds the byte limit.',413);chunks.push(chunk);}
  return Buffer.concat(chunks);
}
async function bodyJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new DomainError('content_type','Use application/json.',415);
  const buffer=await bytes(req,20*1024*1024);let input;
  try {input=JSON.parse(buffer.toString());} catch {throw new DomainError('invalid_json','Invalid JSON body.');}
  assertObject(input);return input;
}

async function readCover(context, media) {
  await context.check(); await context.repo.assert([{target:media.Id,action:'read'}]);
  if (!media.CoverImageBin || !(Number(media.CoverImageBin.Size) > 0) && !['image/png','image/jpeg','image/webp'].includes(media.CoverImageBin.ContentType)) {
    if(!media.CoverImageUrl)return null;
    return fetchPublicCover(media.CoverImageUrl,{origins:coverOrigins(process.env.TIMELINE_COVER_ORIGINS),beforeFetch:async()=>{await context.check();await context.repo.assert([{target:media.Id,action:'read'}]);}});
  }
  const url = context.repo.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({nodeid:String(media.Id),propertyname:'CoverImageBin'});
  const result = await context.repo.request(url,{maxBytes:10*1024*1024});
  if (!result.bytes.length) return null;
  const contentType = result.contentType?.split(';')[0];
  if (!['image/png','image/jpeg','image/webp'].includes(contentType)) return null;
  return {data:result.bytes,contentType};
}
async function exchangeRoute(context,timelineId,operation,req,res,store) {
  requireScope(context,operation === 'export' ? 'exchange:read' : 'exchange:write');
  const timeline = await context.repo.read(assertId(timelineId),{expectedType:'Timeline'});
  const entries = await context.repo.all('TimelineEntry',{parentId:timeline.Id,includeHidden:operation !== 'export'});
  if (operation === 'export') {
    const mediaCache = new Map();
    for (const entry of entries) {
      if (!entry.MediaItem) throw new DomainError('reference_unavailable','Export needs readable local media references.',403);
      if (!mediaCache.has(entry.MediaItem)) mediaCache.set(entry.MediaItem,await context.repo.read(entry.MediaItem,{expectedType:'MediaItem'}));
    }
    await context.check();
    const full = entries.sort((a,b)=>a.Position-b.Position||a.Id-b.Id).map(entry=>({...entry,mediaItem:mediaCache.get(entry.MediaItem)}));
    const archive = await encodeArchive(timeline,full,async media=>{
      try{return await readCover(context,media);}catch(error){if(error?.code?.startsWith('cover_')||error?.code==='invalid_cover')return null;throw error;}
    });
    res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="timeline.zip"','X-Timeline-Skipped-Covers':String(archive.skippedImagesCount)});res.end(archive.buffer);return;
  }
  if (!(req.headers['content-type'] || '').startsWith('application/zip')) throw new DomainError('content_type','Use application/zip for archive preview.',415);
  const archive = await decodeArchive(await bytes(req,64*1024*1024));
  const byName = new Map(entries.map(e=>[e.Name,e])),commands=[],covers=new Map();
  for (const row of archive.entries) {
    const media = await context.repo.read(assertId(Number(row.mediaId)),{expectedType:'MediaItem'});
    const previous = byName.get(row.entryName);
    if (previous && previous.MediaItem !== media.Id) throw new DomainError('reference_conflict','Archive media reference differs from the existing occurrence.',409);
    const fields=entryFieldsFromRow(row,{displayName:media.Title || media.DisplayName});
    commands.push(previous ? {action:'update',targetId:previous.Id,expectedRevision:previous.revision,fields} : {action:'create',type:'TimelineEntry',parentId:timeline.Id,fields});
    if (row.coverImageFilename) {
      const data=archive.covers.get(row.coverImageFilename),base64=data.toString('base64');
      if (covers.has(media.Id) && covers.get(media.Id) !== base64) throw new DomainError('cover_conflict','The archive contains different covers for the same shared media.',409);
      if (!covers.has(media.Id)) {
        const mimeType=data[0]===137 ? 'image/png' : data[0]===255 ? 'image/jpeg' : 'image/webp';
        commands.push({action:'cover',targetId:media.Id,expectedRevision:media.revision,bytesBase64:base64,mimeType,fileName:row.coverImageFilename});covers.set(media.Id,base64);
      }
    }
  }
  const plan=await preview(context,{commands},store); return json(res,200,{...plan,archive:archive.stats});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config=loadConfig({local:process.argv.includes('--local')});
    if(process.argv.includes('--production-provider-keys')) {
      if(!config.local)throw new DomainError('invalid_configuration','The explicit production read-only key source is only for isolated local tests.',503);
      config.providerKeySource=await productionReadOnlyKeySource();
    }
    const app=createApp(config);
    app.server.listen(config.port,config.host,()=>console.log(`Timeline API ready at HTTPS port ${config.port}; project ${config.projectRoot}; ${config.readOnly ? 'read only' : 'writes enabled'}.`));
    for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.server.close(()=>{app.store.close();app.coordinator.close();process.exit(0);}));
  } catch (error) {console.error(error instanceof DomainError ? error.message : 'Gateway configuration failed.');process.exitCode=1;}
}
