// A native process, independent of the SPA and SenseNet admin tooling.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const CHUNK_BYTES = 2 * 1024 * 1024, INLINE_BYTES = 3 * 1024 * 1024, JSON_BYTES = 4 * 1024 * 1024, MAX_BYTES = 64 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isGeneratedId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function failure(message, code, status = 502, result) { const error = new Error(message); Object.assign(error, { code, status, ...(result === undefined ? {} : { result }) }); return error; }
function valueOf(bytes) { try { return JSON.parse(bytes.toString()); } catch { return null; } }
function requireSuccess(response) {
  const value = valueOf(response.body);
  if (response.status < 200 || response.status >= 300 || value?.ok === false) throw failure(value?.error?.message || 'API request failed.', value?.error?.code || 'native_request_failed', response.status, value);
  return value;
}
async function descriptor(response) {
  if (response instanceof Response) return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
  if (!response || !Number.isInteger(response.status) || (!Buffer.isBuffer(response.body) && !Buffer.isBuffer(response.bytes))) throw failure('API response descriptor is invalid.', 'native_response_invalid');
  return { status: response.status, headers: Object.fromEntries(new Headers(response.headers)), body: response.body || response.bytes };
}

/** Follow jobs and owned chunk downloads without replacing an approved plan/key.
 * sendRawRoute retains the original token/binding and returns {status,headers,body:Buffer}.
 * HTTP errors are returned unchanged so raw smoke clients retain their own assertions. */
export async function followNativeResponse(initial, sendRawRoute, options = {}) {
  let response = await descriptor(initial), jobId;
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 15 * 60 * 1000, 15 * 60 * 1000);
  const check = () => { options.checkContext?.(); if (options.signal?.aborted) throw failure('Native response following was canceled.', 'native_follow_canceled', 409); };
  for (;;) {
    check();
    const value = valueOf(response.body), job = value?.job;
    if (response.status === 202 && value?.pending === true) {
      if (!job || !isGeneratedId(job.id) || jobId !== undefined && job.id !== jobId) throw failure('Pending job response is invalid.', 'native_job_invalid');
      jobId = job.id; options.onJob?.(jobId);
      if (Date.now() >= deadline) {
        const error = failure('Job remains pending. Recover it using the same saved plan and apply key.', 'native_job_pending', 504, value);
        Object.assign(error, { jobId, recoverable: true }); throw error;
      }
      const retryAfter = Number(new Headers(response.headers).get('retry-after') || 1);
      const delay = options.pollIntervalMs ?? Math.min(5000, Math.max(250, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000));
      await new Promise(resolve => setTimeout(resolve, Math.max(0, delay))); check();
      try { response = await descriptor(await sendRawRoute(`/jobs/${jobId}`, { method: 'GET' })); }
      catch (error) { Object.assign(error, { jobId, recoverable: true }); throw error; }
      continue;
    }
    if (jobId) options.onJobComplete?.(jobId);
    const download = value?.download;
    if (!download) return { ...response, bytes: response.body, value };
    const { size, chunkSize, chunks } = download;
    if (!isGeneratedId(download.id) || !Number.isSafeInteger(size) || size < 1 || size > MAX_BYTES || chunkSize !== CHUNK_BYTES || chunks !== Math.ceil(size / chunkSize) || typeof download.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(download.sha256) || download.status !== response.status || typeof download.contentType !== 'string') throw failure('Download manifest is invalid.', 'native_transfer_invalid');
    const bytes = Buffer.alloc(size);
    for (let index = 0; index < chunks; index++) {
      check();
      const part = await descriptor(await sendRawRoute(`/downloads/${download.id}/chunks/${index}`, { method: 'GET' }));
      requireSuccess(part); check();
      if (part.body.length !== Math.min(chunkSize, size - index * chunkSize) || new Headers(part.headers).get('x-content-sha256') !== sha256(part.body)) throw failure('Downloaded chunk failed integrity verification.', 'native_transfer_integrity');
      part.body.copy(bytes, index * chunkSize);
    }
    if (sha256(bytes) !== download.sha256) throw failure('Downloaded bytes failed SHA-256 verification.', 'native_transfer_integrity');
    check();
    const headers = {};
    for (const key of ['content-type','content-disposition','x-skipped-images','x-timeline-skipped-images','x-timeline-skipped-covers']) if (typeof download.headers?.[key] === 'string') headers[key] = download.headers[key];
    headers['content-type'] = download.contentType; headers['content-length'] = String(bytes.length); headers['cache-control'] = 'no-store';
    return { status: response.status, headers, body: bytes, bytes, value: valueOf(bytes) };
  }
}

async function stageUpload(send, bytes, input) {
  const digest = sha256(bytes), reserved = requireSuccess(await send('/uploads', { method: 'POST', body: { ...input, size: bytes.length, sha256: digest } }))?.upload;
  if (!reserved || !isGeneratedId(reserved.id) || reserved.size !== bytes.length || reserved.sha256 !== digest || reserved.chunkSize !== CHUNK_BYTES || reserved.chunks !== Math.ceil(bytes.length / CHUNK_BYTES)) throw failure('Upload reservation is invalid.', 'native_transfer_invalid');
  for (let index = 0; index < reserved.chunks; index++) requireSuccess(await send(`/uploads/${reserved.id}/chunks/${index}`, { method: 'POST', body: bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES), contentType: 'application/octet-stream' }));
  const completed = requireSuccess(await send(`/uploads/${reserved.id}/complete`, { method: 'POST', body: {} }))?.upload;
  if (!completed || completed.id !== reserved.id || completed.complete !== true || completed.size !== bytes.length || completed.sha256 !== digest) throw failure('Completed upload is invalid.', 'native_transfer_invalid');
  return reserved.id;
}
async function stageInput(route, options, send) {
  if (route === '/plans' && options.body && typeof options.body === 'object' && !Buffer.isBuffer(options.body) && Array.isArray(options.body.commands)) {
    const largeBatch = Buffer.byteLength(JSON.stringify(options.body)) > JSON_BYTES, commands = [];
    for (const command of options.body.commands) {
      if (!command || typeof command !== 'object') { commands.push(command); continue; }
      const cover = command.action === 'cover' ? command : command.action === 'metadata' ? command.cover : null;
      if (!cover || typeof cover.bytesBase64 !== 'string' || (!largeBatch && cover.bytesBase64.length <= INLINE_BYTES)) { commands.push(command); continue; }
      if (cover.bytesBase64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(cover.bytesBase64)) throw failure('Staged cover bytes are invalid.', 'invalid_cover', 400);
      const bytes = Buffer.from(cover.bytesBase64, 'base64');
      if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw failure('Cover exceeds the application byte limit.', 'native_payload_limit', 413);
      const uploadId = await stageUpload(send, bytes, { kind: 'cover', targetId: command.targetId, expectedRevision: command.expectedRevision, mimeType: cover.mimeType, fileName: cover.fileName || 'cover' });
      const { bytesBase64: _bytes, ...staged } = cover;
      commands.push(command.action === 'cover' ? { ...staged, uploadId } : { ...command, cover: { ...staged, uploadId } });
    }
    return { ...options, body: { ...options.body, commands } };
  }
  const zip = route.match(/^\/exchange\/(\d+)\/preview$/);
  if (zip && Buffer.isBuffer(options.body) && options.body.length > INLINE_BYTES) {
    if (options.body.length > MAX_BYTES) throw failure('ZIP exceeds the application byte limit.', 'native_payload_limit', 413);
    const uploadId = await stageUpload(send, options.body, { kind: 'zip', targetId: Number(zip[1]), mimeType: 'application/zip', fileName: 'timeline.zip' });
    return { ...options, body: { uploadId }, contentType: 'application/json' };
  }
  return options;
}

export function createClient(config) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/api/v1')) throw new Error('Configure an HTTPS /api/v1 base URL.');
  const ca = config.caFile ? fs.readFileSync(config.caFile) : undefined;
  const headers = Object.freeze({'X-Timeline-Repository':config.repository,'X-Timeline-Authority':config.authority,'X-Timeline-Project':config.project});
  const rawRequest = (route,{method='GET',body,token,backendAuth,contentType,idempotencyKey}={}) => new Promise((resolve,reject)=> {
    if (typeof route !== 'string' || !/^\/[A-Za-z0-9/_-]+(?:\?[^#\r\n]*)?$/.test(route) || route.includes('..')) return reject(failure('Invalid API route.', 'invalid_native_path', 400));
    const target = new URL(base.href + route);
    if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname + '/') || target.username || target.password || target.hash) return reject(failure('Invalid API route.', 'invalid_native_path', 400));
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    if (payload?.length > JSON_BYTES) return reject(failure('API request exceeds the buffered wire limit.', 'native_payload_limit', 413));
    const auth = token ? {'Authorization':'Bearer '+token} : {};
    const req=https.request(target,{method,ca,headers:{...headers,...auth,...(backendAuth?{'X-Timeline-Backend-Auth':backendAuth}:{}),...(payload?{'Content-Type':contentType||'application/json','Content-Length':payload.length}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})}},res=> {
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>JSON_BYTES)req.destroy(failure('API response exceeds the buffered wire limit.', 'native_response_limit'));else chunks.push(chunk);});
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      res.on('error',()=>reject(failure('HTTPS API response transport failed.', 'native_transport_failed', 503)));
    });
    req.setTimeout(120000,()=>req.destroy(failure('API request timed out; recover an apply with the saved plan/key.', 'native_transport_timeout', 504)));
    const deadline = setTimeout(() => req.destroy(failure('API request timed out; recover an apply with the saved plan/key.', 'native_transport_timeout', 504)), 120000);
    req.once('close', () => clearTimeout(deadline));
    req.on('error',error=>reject(error.code?.startsWith('native_')?error:failure('HTTPS API transport failed.', 'native_transport_failed', 503)));req.end(payload);
  });
  const request = async (route, options = {}) => {
    // Capture this request's original credential/binding for every poll and chunk.
    const auth = { token: options.token, backendAuth: options.backendAuth };
    const send = (nextRoute, nextOptions = {}) => rawRequest(nextRoute, { ...nextOptions, ...auth });
    const staged = await stageInput(route, options, send);
    const response = await followNativeResponse(await rawRequest(route, staged), send, { timeoutMs: options.jobTimeoutMs, pollIntervalMs: options.pollIntervalMs, checkContext: options.checkContext, signal: options.signal });
    const value = requireSuccess(response);
    return options.binary ? response.body : value;
  };
  const verify = async()=> {const c=await request('/capabilities');if(c.repository!==config.repository||c.authority!==config.authority||c.project!==config.project)throw new Error('Gateway target binding differs from client configuration.');return c;};
  return {request,rawRequest,verify};
}

function savePrivateCredential(file, contents) {
  const resolved = path.resolve(file), handle = fs.openSync(resolved, 'wx', 0o600);
  try {
    if (process.platform === 'win32') {
      const user = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : process.env.USERNAME;
      if (!user) throw new Error('Current Windows account is unavailable for private credential storage.');
      // Remove inherited access before plaintext is written. No credential enters process arguments.
      execFileSync('icacls.exe', [resolved, '/inheritance:r', '/grant:r', user + ':(F)'], { stdio: 'ignore', windowsHide: true });
    }
    fs.writeFileSync(handle, contents); fs.fsyncSync(handle);
  } catch { fs.closeSync(handle); fs.unlinkSync(resolved); throw new Error('Unable to protect the credential file; no credential was saved.'); }
  fs.closeSync(handle);
}
async function main() {
  const [command,...args]=process.argv.slice(2),flags={};
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw new Error('Use --name value arguments.');flags[args[i].slice(2)]=args[i+1];}
  if(!flags.config)throw new Error('Use --config <public-client-config.json>. Commands: discover, grant, read, list, preview, apply, job, revoke, recovery, export, import-preview.');
  const config=JSON.parse(fs.readFileSync(flags.config,'utf8')),client=createClient(config);await client.verify();
  const secret = file=> {if(!file)throw new Error('A token file is required.');const text=fs.readFileSync(file,'utf8').trim();if(text.startsWith('{'))return JSON.parse(text).token;return text;};
  const token=command==='discover'?undefined:secret(flags['token-file']);let result;
  if(command==='discover')result=await client.request('/capabilities');
  else if(command==='grant') {
    if(!flags.out)throw new Error('Grant issuance requires --out <private-credential.json>.');
    result=await client.request('/grants',{method:'POST',token,backendAuth:flags['backend-auth']||'Bearer',body:{scopes:(flags.scopes||'content:read').split(','),expiresInSeconds:Number(flags.lifetime||86400)}});
    savePrivateCredential(flags.out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({id:result.id,scopes:result.scopes,expiresAt:result.expiresAt,credentialFile:path.resolve(flags.out)}));return;
  } else if(command==='read')result=await client.request('/content/'+positive(flags.id),{token});
  else if(command==='list') {if(!['timelines','media','books','entries'].includes(flags.kind))throw new Error('Choose list kind timelines, media, books or entries.');result=await client.request('/'+flags.kind+'?'+new URLSearchParams({top:flags.top||'50',skip:flags.skip||'0',...(flags.search?{search:flags.search}:{}),...(flags.timeline?{timelineId:flags.timeline}:{})}),{token});}
  else if(command==='preview')result=await client.request('/plans',{method:'POST',token,body:JSON.parse(fs.readFileSync(flags.input,'utf8'))});
  else if(command==='apply') {
    if(!flags.plan || !/^[A-Za-z0-9_.:-]{8,128}$/.test(flags.key||''))throw new Error('Apply requires the saved --plan and an explicit stable --key (8-128 letters, digits, _, ., :, -). Reuse both after a lost response.');
    result=await client.request('/plans/'+generatedId(flags.plan,'--plan')+'/apply',{method:'POST',token,body:{},idempotencyKey:flags.key});
  }
  else if(command==='job') {
    const response=await client.rawRequest('/jobs/'+generatedId(flags.id,'--id'),{token});
    const body=Buffer.from(response.body ?? response.bytes ?? []);
    if(response.headers['content-type']?.includes('application/json'))result={status:response.status,...JSON.parse(body.toString())};
    else result={status:response.status,contentType:response.headers['content-type'],bytes:body.length};
    if(response.status>=400)process.exitCode=1;
  }
  else if(command==='revoke')result=await client.request('/grants/'+generatedId(flags.id,'--id')+'/revoke',{method:'POST',token,backendAuth:flags['backend-auth'],body:{}});
  else if(command==='recovery')result=await client.request('/recovery',{method:'POST',token,backendAuth:flags['backend-auth'],body:{planId:generatedId(flags.plan,'--plan'),...(flags['stopped-request']?{stoppedRequestId:generatedId(flags['stopped-request'],'--stopped-request')}:{})}});
  else if(command==='export') {if(!flags.out)throw new Error('Export requires --out.');const data=await client.request('/exchange/'+positive(flags.timeline)+'/export',{token,binary:true});fs.writeFileSync(flags.out,data,{flag:'wx'});console.log(JSON.stringify({exportFile:path.resolve(flags.out),bytes:data.length}));return;}
  else if(command==='import-preview')result=await client.request('/exchange/'+positive(flags.timeline)+'/preview',{method:'POST',token,body:fs.readFileSync(flags.input),contentType:'application/zip'});
  else throw new Error('Unknown client command.');
  const serialized=JSON.stringify(result,null,2)+'\n';if(flags.out)fs.writeFileSync(flags.out,serialized,{flag:'wx'});else process.stdout.write(serialized);
}
function generatedId(value,label){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error(label+' must be a generated UUID from the saved gateway result.');return value.toLowerCase();}
function positive(value){if(!/^\d+$/.test(value)||Number(value)<1)throw new Error('A positive content ID is required.');return value;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(`${error.code||'client_error'}: ${error.message}`);if(error.jobId&&/^[0-9a-f-]{36}$/i.test(error.jobId))console.error(JSON.stringify({jobId:error.jobId,recoverable:error.recoverable===true,hint:'Read the owned job with the job command; retain the original plan and key.'}));process.exitCode=1;});
