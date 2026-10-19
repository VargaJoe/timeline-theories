import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createClient } from './m1-client.mjs';
import { decodeArchive } from '../client/api/exchange.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8080', PROJECT = '/Root/Content/timelines', SOURCE_COUNT = 2998;
const CHUNK_BYTES = 2 * 1024 * 1024, INLINE_BYTES = 3 * 1024 * 1024, WIRE_BYTES = 4 * 1024 * 1024;
const STATE = path.join(local.ROOT,'m1-large-transfer-state.json'), REPORT = path.join(local.ROOT,'m1-large-transfer-report.json');
const SCOPES = ['content:read','timelines:write','media:write','entries:write','covers:write','exchange:read','exchange:write'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceId = value => Array.isArray(value) ? referenceId(value[0]) : value && typeof value === 'object' ? value.Id : value;
const single = value => Array.isArray(value) ? value[0] : value;
let restoredIds;
const protectedIds = () => restoredIds ||= new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8')).idMap).map(Number));
const client = () => createClient({baseUrl:GATEWAY+'/api/v1',repository:local.REPOSITORY,authority:local.AUTHORITY,project:PROJECT,caFile:path.join(local.ROOT,'certificates/localhost.pem')});
const errorInfo = error => ({status:error.status??null,code:error.code||(error.name==='AssertionError'?'large_transfer_assertion_failed':'large_transfer_transport_failed'),location:error.stack?.split('\n').find(line=>/m1-large-transfer-smoke\.mjs:\d+:\d+/.test(line))?.trim()});

const CRC_TABLE = Uint32Array.from({length:256},(_value,index)=>{let crc=index;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function pngChunk(type,data) {
  const kind=Buffer.from(type,'ascii'),chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);kind.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return chunk;
}
/** Real deterministic RGB scanlines. Random-looking pixels avoid a tiny compressed fixture. */
export function createFixturePng(width=2048,height=1024) {
  assert.ok(Number.isInteger(width)&&width>0&&width<=2048&&Number.isInteger(height)&&height>0&&height<=1024);
  const stride=width*3+1,pixels=Buffer.alloc(stride*height);let seed=0x54_49_4d_45;
  for(let row=0;row<height;row++)for(let column=1;column<stride;column++) {seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels[row*stride+column]=seed&255;}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',deflateSync(pixels,{level:6})),pngChunk('IEND',Buffer.alloc(0))]);
  const inspected=inspectFixturePng(bytes);assert.equal(inspected.scanlineSha256,sha256(pixels));return bytes;
}
/** Validate every PNG CRC, zlib stream, dimensions, color/depth and actual decoded filter byte. */
export function inspectFixturePng(bytes) {
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const chunks=[],compressed=[];let offset=8,width,height;
  while(offset<bytes.length) {
    assert.ok(offset+12<=bytes.length);const size=bytes.readUInt32BE(offset),end=offset+size+12;assert.ok(end<=bytes.length);
    const type=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);assert.equal(crc32(bytes.subarray(offset+4,end-4)),bytes.readUInt32BE(end-4));chunks.push(type);
    if(type==='IHDR'){assert.equal(size,13);width=data.readUInt32BE(0);height=data.readUInt32BE(4);assert.equal(data.subarray(8).toString('hex'),'0802000000');}
    if(type==='IDAT')compressed.push(data);if(type==='IEND')assert.equal(size,0);offset=end;
  }
  assert.deepEqual(chunks,['IHDR','IDAT','IEND']);const stride=width*3+1,pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:stride*height});assert.equal(pixels.length,stride*height);
  for(let row=0;row<height;row++)assert.equal(pixels[row*stride],0);
  return {width,height,colorType:'RGB',bitDepth:8,bytes:bytes.length,sha256:sha256(bytes),scanlineSha256:sha256(pixels),validatedCrcAndZlib:true};
}

function saveState(state) {
  assert.equal(path.dirname(STATE),path.resolve(local.ROOT));execFileSync('git',['check-ignore','--quiet',STATE],{stdio:'ignore',windowsHide:true});
  const temporary=STATE+'.'+randomUUID()+'.tmp',handle=fs.openSync(temporary,'wx',0o600);
  try {
    if(process.platform==='win32') {const user=process.env.USERDOMAIN?process.env.USERDOMAIN+'\\'+process.env.USERNAME:process.env.USERNAME;if(!user)throw new Error('Private state owner is unavailable.');execFileSync('icacls.exe',[temporary,'/inheritance:r','/grant:r',user+':(F)'],{stdio:'ignore',windowsHide:true});}
    fs.writeFileSync(handle,JSON.stringify(state,null,2));fs.fsyncSync(handle);
  }catch{fs.closeSync(handle);fs.unlinkSync(temporary);throw new Error('Private transfer smoke state could not be saved.');}
  fs.closeSync(handle);fs.renameSync(temporary,STATE);
}
function loadState() {
  const state=JSON.parse(fs.readFileSync(STATE,'utf8'));assert.equal(state.version,1);assert.equal(state.gateway,GATEWAY);assert.equal(state.repository,local.REPOSITORY);assert.equal(state.project,PROJECT);
  assert.match(state.prefix,/^m1-large-transfer-[0-9a-f-]{36}$/);assert.ok(Array.isArray(state.fixtures)&&Array.isArray(state.reservations)&&Array.isArray(state.operations));return state;
}
/** Observe real client HTTPS traffic; no headers, credential bodies or repository content are logged. */
function trafficTrace() {
  const original=https.request,rows=[],jobs=new Set(),repositoryMethods=new Set();let phase='setup',lastProgress=Date.now();
  https.request=function(target,options,callback) {
    const url=target instanceof URL?target:new URL(target),method=(options?.method||'GET').toUpperCase();
    if(url.origin!==GATEWAY) {assert.ok([local.REPOSITORY,local.AUTHORITY].includes(url.origin));assert.ok(['GET','HEAD'].includes(method),'Raw repository mutations are unavailable in this smoke.');repositoryMethods.add(method);return original.call(https,target,options,callback);}
    assert.ok(url.pathname.startsWith('/api/v1/'));const headers=new Headers(options.headers),requestBytes=Number(headers.get('content-length')||0);assert.ok(requestBytes<=WIRE_BYTES,'Client sent an oversized API body instead of staging.');
    const row={phase,route:url.pathname,method,requestBytes,status:null,responseBytes:0};rows.push(row);
    return original.call(https,target,options,response=> {
      row.status=response.statusCode;const pending=[];let captureBytes=0;
      response.on('data',chunk=>{row.responseBytes+=chunk.length;if(response.statusCode===202&&captureBytes<8192){pending.push(chunk);captureBytes+=chunk.length;}});
      response.on('end',()=>{
        if(response.statusCode===202&&captureBytes<=8192){try{const value=JSON.parse(Buffer.concat(pending).toString());if(value.pending===true&&typeof value.job?.id==='string')jobs.add(value.job.id);}catch{/* Client validation owns malformed responses. */}}
        if(Date.now()-lastProgress>30000){lastProgress=Date.now();console.log(JSON.stringify({phase:row.phase,observedRequests:rows.length,observedJobs:jobs.size}));}
      });
      callback(response);
    });
  };
  return {rows,jobs,repositoryMethods,setPhase:value=>{phase=value;},close:()=>{https.request=original;}};
}
async function sourceCount() {
  const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:'+InTree:'+PROJECT+' .AUTOFILTERS:OFF .LIFESPAN:OFF','$top':'0','$inlinecount':'allpages',metadata:'no'}),{account:local.readAccounts().admin});
  assert.equal(response.status,200);const count=Number(response.value?.d?.__count);assert.ok(Number.isSafeInteger(count));return count;
}
async function assertApp(api){const capabilities=await api.verify();assert.equal(capabilities.runtime,'Netlify Functions in the Timeline app');assert.equal(capabilities.limits.chunkBytes,CHUNK_BYTES);assert.equal(capabilities.limits.jsonBytes,WIRE_BYTES);return capabilities;}
const read=async(api,state,id)=>(await api.request('/content/'+id,{token:state.grant.token})).data;
const lookup=async(api,state,target)=>(await api.request('/lookup',{method:'POST',token:state.grant.token,body:{target}})).data;
const list=async(api,state)=>(await api.request('/entries?'+new URLSearchParams({timelineId:String(state.timelineId),top:'100',includeHidden:'true'}),{token:state.grant.token})).items;
async function preview(api,state,commands){const plan=await api.request('/plans',{method:'POST',token:state.grant.token,body:{commands}});assert.equal(plan.repositoryWrites,0);return plan;}
function operation(state,kind,plan,targetId){const row={kind,plan,key:randomUUID(),...(targetId?{targetId}:{})};state.operations.push(row);saveState(state);return row;}
async function apply(api,state,step){const result=await api.request('/plans/'+step.plan.id+'/apply',{method:'POST',token:state.grant.token,body:{},idempotencyKey:step.key});assert.equal(result.ok,true);step.completed=true;saveState(state);return result;}
function own(state,content){assert.ok(!protectedIds().has(content.Id));assert.ok(content.Name.startsWith(state.prefix)&&content.Path.startsWith(PROJECT+'/'));assert.ok(state.reservations.some(row=>row.name===content.Name&&row.path===content.Path&&row.type===content.Type),'Exact reserved UUID/type/path ownership is unavailable.');return content;}
function remember(state,content){own(state,content);const row={id:content.Id,name:content.Name,path:content.Path,type:content.Type,deleted:false},existing=state.fixtures.find(value=>value.id===content.Id);if(existing)Object.assign(existing,row);else state.fixtures.push(row);saveState(state);return content;}
function reserve(state,type,name,parentPath){assert.ok(name.startsWith(state.prefix));state.reservations.push({type,name,path:parentPath+'/'+name});saveState(state);}
async function create(api,state,type,fields,parentPath,parentId){reserve(state,type,fields.Name,parentPath);const plan=await preview(api,state,[{action:'create',type,fields,...(parentId?{parentId}:{})}]);const result=await apply(api,state,operation(state,'setup-create',plan));return remember(state,await read(api,state,result.completed[0].result.id));}
function transferRows(trace,phase,kind){return trace.rows.filter(row=>row.phase===phase&&new RegExp('/'+kind+'/[0-9a-f-]{36}/chunks/\\d+$').test(row.route));}
function assertChunks(trace,phase,kind,bytes) {
  const rows=transferRows(trace,phase,kind);assert.equal(rows.length,Math.ceil(bytes/CHUNK_BYTES),'Real chunk route count differs from the complete payload.');
  for(const row of rows){assert.equal(row.status,200);assert.equal(row.method,kind==='uploads'?'POST':'GET');assert.ok((kind==='uploads'?row.requestBytes:row.responseBytes)<=CHUNK_BYTES);}
  return rows.length;
}
function fields(content){return {Name:content.Name,MediaItem:referenceId(content.MediaItem),Position:content.Position,Notes:content.Notes,ChronologicalDate:content.ChronologicalDate,ChronologicalDescription:content.ChronologicalDescription,EntryLabel:single(content.EntryLabel),Importance:single(content.Importance)};}
function exactBytes(actual,expected){assert.equal(actual.length,expected.length,'Binary byte length changed.');assert.equal(sha256(actual),sha256(expected),'Binary SHA-256 changed.');}

/** Only own reserved UUIDs are discovered/deleted, through the scoped API. No raw write fallback. */
export async function cleanup(state=loadState()) {
  const api=client(),results=[];await assertApp(api);
  if(state.grant?.token) {
    for(const reservation of state.reservations){let content;try{content=await lookup(api,state,reservation.path);}catch(error){if(error.status===404)continue;throw error;}assert.equal(content.Name,reservation.name);assert.equal(content.Path,reservation.path);assert.equal(content.Type,reservation.type);remember(state,content);}
    const sorted=[...state.fixtures].sort((a,b)=>({TimelineEntry:0,Timeline:1,MediaItem:2}[a.type]-{TimelineEntry:0,Timeline:1,MediaItem:2}[b.type]));
    for(const fixture of sorted) {
      let current;try{current=await read(api,state,fixture.id);}catch(error){if(error.status===404){const pending=state.operations.find(row=>row.kind==='cleanup'&&row.targetId===fixture.id&&!row.completed);if(pending)await apply(api,state,pending);results.push({id:fixture.id,deleted:true,alreadyAbsent:true});continue;}throw error;}
      own(state,current);assert.equal(current.Name,fixture.name);assert.equal(current.Path,fixture.path);
      let step=state.operations.find(row=>row.kind==='cleanup'&&row.targetId===fixture.id&&!row.completed);if(!step)step=operation(state,'cleanup',await preview(api,state,[{action:'delete',targetId:fixture.id,expectedRevision:current.revision}]),fixture.id);
      await apply(api,state,step);await assert.rejects(read(api,state,fixture.id),error=>error.status===404);fixture.deleted=true;results.push({id:fixture.id,deleted:true,via:'native-app'});state.cleanup=results;saveState(state);
    }
    assert.equal(await sourceCount(),SOURCE_COUNT);await api.request('/grants/'+state.grant.id+'/revoke',{method:'POST',token:state.grant.token,body:{}});state.grant.token=null;
  }
  assert.equal(await sourceCount(),SOURCE_COUNT);state.phase='cleaned';state.cleanup=results;saveState(state);return results;
}

export async function run() {
  if(fs.existsSync(STATE)){const previous=JSON.parse(fs.readFileSync(STATE,'utf8'));assert.ok(['completed','cleaned'].includes(previous.phase),'Clean the previous owned large-transfer fixture first.');}
  const png=createFixturePng(),image=inspectFixturePng(png);assert.ok(png.length>INLINE_BYTES&&png.length<10*1024*1024);
  const state={version:1,phase:'preparing',gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,prefix:'m1-large-transfer-'+randomUUID(),fixtures:[],reservations:[],operations:[]};saveState(state);
  const report={version:1,architecture:'one-netlify-app-owned-chunk-transfers',ranAt:new Date().toISOString(),gateway:GATEWAY,repository:local.REPOSITORY,project:PROJECT,fixturePrefix:state.prefix,image,checks:[],cleanup:[],passed:false,
    scope:'Actual valid roughly 6 MiB PNG and two-occurrence archive through the one local Netlify app. Full 64 MiB transport envelopes are separately exercised by SDK unit tests; this live smoke is bounded below that size.'};
  const api=client(),trace=trafficTrace();let failure;
  const record=(name,details={})=>{report.checks.push({name,...details,passed:true});console.log(JSON.stringify(report.checks.at(-1)));};
  const phase=name=>{state.phase=name;trace.setPhase(name);saveState(state);};
  try {
    await assertApp(api);protectedIds();report.initialCount=await sourceCount();assert.equal(report.initialCount,SOURCE_COUNT,'Other owned fixture phases must finish first.');
    state.grant=await api.request('/grants',{method:'POST',token:local.readAccounts().editor.apiKey,backendAuth:'ApiKey',body:{scopes:SCOPES,expiresInSeconds:3600}});saveState(state);
    record('Deterministic fixture is a complete RGB PNG with valid chunk CRCs, zlib and decoded scanlines',{bytes:png.length,width:image.width,height:image.height,sha256:image.sha256});
    const timeline=await create(api,state,'Timeline',{Name:state.prefix+'-timeline',DisplayName:'Owned large transfer timeline',IsVisible:true},PROJECT+'/Timelines');state.timelineId=timeline.Id;saveState(state);
    let media=await create(api,state,'MediaItem',{Name:state.prefix+'-media',DisplayName:'Owned large transfer media',Title:'Actual large cover',Description:'Deterministic PNG and active ZIP exchange fixture',MediaType:'movie'},PROJECT+'/MediaLibrary');state.mediaId=media.Id;saveState(state);
    const names=[state.prefix+'-first',state.prefix+'-second'];names.forEach(name=>reserve(state,'TimelineEntry',name,timeline.Path));
    const entriesPlan=await preview(api,state,names.map((Name,index)=>({action:'create',type:'TimelineEntry',parentId:timeline.Id,fields:{Name,DisplayName:'Own large transfer occurrence '+(index+1),MediaItem:media.Id,Position:index+1,Notes:'Large transfer occurrence '+(index+1)+'\nTab\tand backslash \\',ChronologicalDate:index===0?'2024-01-01':'2024-02-02',ChronologicalDescription:'Own chronology '+(index+1),EntryLabel:index===0?'mainstory':'flashback',Importance:index===0?'essential':'optional'}})));
    await apply(api,state,operation(state,'setup-entries',entriesPlan));const originals=await list(api,state);assert.equal(originals.length,2);for(const entry of originals)remember(state,entry);state.originalEntryIds=originals.map(row=>row.Id);state.expected=Object.fromEntries(originals.map(row=>[row.Name,fields(row)]));saveState(state);
    assert.equal(await sourceCount(),SOURCE_COUNT+4);

    phase('cover-preview');const beforeCover=media;
    const coverPlan=await preview(api,state,[{action:'cover',targetId:media.Id,expectedRevision:media.revision,bytesBase64:png.toString('base64'),mimeType:'image/png',fileName:'large-valid.png'}]);
    const coverUploadChunks=assertChunks(trace,'cover-preview','uploads',png.length);assert.equal((await read(api,state,media.Id)).revision,beforeCover.revision);
    phase('cover-apply');await apply(api,state,operation(state,'cover',coverPlan));media=await read(api,state,media.Id);assert.notEqual(media.revision,beforeCover.revision);
    phase('cover-download');const downloaded=await api.request('/content/'+media.Id+'/cover',{token:state.grant.token,binary:true});exactBytes(downloaded,png);inspectFixturePng(downloaded);
    const coverDownloadChunks=assertChunks(trace,'cover-download','downloads',png.length);
    record('Native client automatically stages the large cover and reconstructs exact repository bytes from owned downloads',{bytes:png.length,uploadChunks:coverUploadChunks,downloadChunks:coverDownloadChunks,previewRepositoryWrites:coverPlan.repositoryWrites});

    phase('zip-export');const archiveBytes=await api.request('/exchange/'+timeline.Id+'/export',{token:state.grant.token,binary:true});assert.ok(archiveBytes.length>INLINE_BYTES&&archiveBytes.length<64*1024*1024);
    const exportChunks=assertChunks(trace,'zip-export','downloads',archiveBytes.length),archive=await decodeArchive(archiveBytes);assert.equal(archive.entries.length,2);assert.equal(archive.covers.size,2);
    for(const cover of archive.covers.values())exactBytes(cover,png);for(const entry of archive.entries){assert.ok(names.includes(entry.entryName));assert.equal(Number(entry.mediaId),media.Id);}
    report.archive={bytes:archiveBytes.length,sha256:sha256(archiveBytes),entries:archive.entries.length,covers:archive.covers.size};
    record('Real large ZIP export follows private chunks and decodes both exact covers for one shared media ID',{...report.archive,downloadChunks:exportChunks});

    phase('entries-clear');const currentEntries=await list(api,state),clearPlan=await preview(api,state,currentEntries.map(entry=>({action:'delete',targetId:entry.Id,expectedRevision:entry.revision})));await apply(api,state,operation(state,'clear-occurrences',clearPlan));
    assert.equal((await list(api,state)).length,0);for(const entry of currentEntries){await assert.rejects(read(api,state,entry.Id),error=>error.status===404);state.fixtures.find(row=>row.id===entry.Id).deleted=true;}saveState(state);assert.equal(await sourceCount(),SOURCE_COUNT+2);

    phase('zip-import-preview');const beforeImport=await read(api,state,media.Id);
    const importPlan=await api.request('/exchange/'+timeline.Id+'/preview',{method:'POST',token:state.grant.token,body:archiveBytes,contentType:'application/zip'});assert.equal(importPlan.repositoryWrites,0);assert.equal(importPlan.archive.entriesCount,2);assert.equal(importPlan.archive.coversCount,2);
    const importChunks=assertChunks(trace,'zip-import-preview','uploads',archiveBytes.length);assert.equal((await list(api,state)).length,0);assert.equal((await read(api,state,media.Id)).revision,beforeImport.revision);
    phase('zip-import-apply');await apply(api,state,operation(state,'import',importPlan));const imported=await list(api,state);assert.equal(imported.length,2);assert.equal(new Set(imported.map(row=>row.Id)).size,2);
    for(const entry of imported){remember(state,entry);assert.ok(!state.originalEntryIds.includes(entry.Id));assert.deepEqual(fields(entry),state.expected[entry.Name]);assert.equal(referenceId(entry.MediaItem),media.Id);}
    assert.equal(await sourceCount(),SOURCE_COUNT+4);assert.equal((await read(api,state,media.Id)).Id,state.mediaId);
    phase('cover-readback');const readback=await api.request('/content/'+media.Id+'/cover',{token:state.grant.token,binary:true});exactBytes(readback,png);const readbackChunks=assertChunks(trace,'cover-readback','downloads',png.length);
    record('Native ZIP preview stages the complete archive without writes; apply restores two occurrences referencing the existing media and exact cover bytes',{archiveUploadChunks:importChunks,coverReadbackChunks:readbackChunks,existingMediaId:media.Id,occurrences:imported.length});
    assert.ok(trace.jobs.size>=6);assert.ok(trace.rows.every(row=>row.requestBytes<=WIRE_BYTES&&row.responseBytes<=WIRE_BYTES));
    record('Observed real API bodies stay within buffered wire bounds and all transfer chunks stay at or below 2 MiB',{jobs:trace.jobs.size,maxRequestBytes:Math.max(...trace.rows.map(row=>row.requestBytes)),maxResponseBytes:Math.max(...trace.rows.map(row=>row.responseBytes))});
  }catch(error){failure=error;report.error=errorInfo(error);state.phase='failed';saveState(state);}
  finally {
    trace.setPhase('cleanup');
    try{report.cleanup=await cleanup(state);report.finalCount=await sourceCount();assert.equal(report.finalCount,SOURCE_COUNT);}
    catch(error){failure ||= error;report.cleanupError=errorInfo(error);state.phase='cleanup_failed';saveState(state);}
    report.traffic={requests:trace.rows,jobIds:[...trace.jobs],uploadChunkRequests:trace.rows.filter(row=>/\/uploads\/[^/]+\/chunks\//.test(row.route)).length,downloadChunkRequests:trace.rows.filter(row=>/\/downloads\/[^/]+\/chunks\//.test(row.route)).length,rawRepositoryMethods:[...trace.repositoryMethods],maxRequestBytes:Math.max(0,...trace.rows.map(row=>row.requestBytes)),maxResponseBytes:Math.max(0,...trace.rows.map(row=>row.responseBytes))};trace.close();
    report.passed=!failure;if(report.passed){state.phase='completed';saveState(state);}fs.writeFileSync(REPORT,JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,uploadChunkRequests:report.traffic.uploadChunkRequests,downloadChunkRequests:report.traffic.downloadChunkRequests,cleaned:report.cleanup.filter(row=>row.deleted).length,initialCount:report.initialCount,finalCount:report.finalCount,report:REPORT}));
  if(failure)throw new Error('Netlify large transfer acceptance failed; inspect the sanitized report and retained private state.');return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--run')run().catch(()=>{console.error('netlify_large_transfer_failed');process.exitCode=1;});
  else if(args.length===1&&args[0]==='--cleanup')cleanup().then(rows=>console.log(JSON.stringify({cleaned:rows.length,sourceCount:SOURCE_COUNT}))).catch(()=>{console.error('netlify_large_transfer_cleanup_failed');process.exitCode=1;});
  else{console.error('Use --run after other fixture gates finish, or --cleanup for a retained owned fixture.');process.exitCode=1;}
}
