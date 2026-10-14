// A native process, independent of the SPA and SenseNet admin tooling.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function createClient(config) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/api/v1')) throw new Error('Configure an HTTPS /api/v1 base URL.');
  const ca = config.caFile ? fs.readFileSync(config.caFile) : undefined;
  const headers = {'X-Timeline-Repository':config.repository,'X-Timeline-Authority':config.authority,'X-Timeline-Project':config.project};
  const request = (route,{method='GET',body,token,backendAuth,contentType,idempotencyKey,binary=false}={}) => new Promise((resolve,reject)=> {
    if (!route.startsWith('/') || route.includes('..') || route.includes('://')) return reject(new Error('Invalid API route.'));
    const target = new URL(base.href + route);
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const auth = token ? {'Authorization':'Bearer '+token} : {};
    const req=https.request(target,{method,ca,headers:{...headers,...auth,...(backendAuth?{'X-Timeline-Backend-Auth':backendAuth}:{}),...(payload?{'Content-Type':contentType||'application/json','Content-Length':payload.length}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})}},res=> {
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>64*1024*1024)req.destroy(new Error('API response exceeds the byte limit.'));else chunks.push(chunk);});
      res.on('end',()=>{const bytes=Buffer.concat(chunks);let value;try{value=JSON.parse(bytes.toString());}catch{value=null;}
        if(res.statusCode<200||res.statusCode>=300 || value?.ok===false) {const error=new Error(value?.error?.message || 'API request failed.');error.status=res.statusCode;error.code=value?.error?.code;error.result=value;reject(error);}else resolve(binary?bytes:value);
      });
    });
    req.setTimeout(120000,()=>req.destroy(new Error('API request timed out.')));req.on('error',()=>reject(new Error('HTTPS API transport failed.')));req.end(payload);
  });
  const verify = async()=> {const c=await request('/capabilities');if(c.repository!==config.repository||c.authority!==config.authority||c.project!==config.project)throw new Error('Gateway target binding differs from client configuration.');return c;};
  return {request,verify};
}
async function main() {
  const [command,...args]=process.argv.slice(2),flags={};
  for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1])throw new Error('Use --name value arguments.');flags[args[i].slice(2)]=args[i+1];}
  if(!flags.config)throw new Error('Use --config <public-client-config.json>. Commands: discover, grant, read, list, preview, apply, revoke, recovery, export, import-preview.');
  const config=JSON.parse(fs.readFileSync(flags.config,'utf8')),client=createClient(config);await client.verify();
  const secret = file=> {if(!file)throw new Error('A token file is required.');const text=fs.readFileSync(file,'utf8').trim();if(text.startsWith('{'))return JSON.parse(text).token;return text;};
  const token=command==='discover'?undefined:secret(flags['token-file']);let result;
  if(command==='discover')result=await client.request('/capabilities');
  else if(command==='grant') {
    if(!flags.out)throw new Error('Grant issuance requires --out <private-credential.json>.');
    result=await client.request('/grants',{method:'POST',token,backendAuth:flags['backend-auth']||'Bearer',body:{scopes:(flags.scopes||'content:read').split(','),expiresInSeconds:Number(flags.lifetime||86400)}});
    fs.writeFileSync(flags.out,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({id:result.id,scopes:result.scopes,expiresAt:result.expiresAt,credentialFile:path.resolve(flags.out)}));return;
  } else if(command==='read')result=await client.request('/content/'+positive(flags.id),{token});
  else if(command==='list') {if(!['timelines','media','books','entries'].includes(flags.kind))throw new Error('Choose list kind timelines, media, books or entries.');result=await client.request('/'+flags.kind+'?'+new URLSearchParams({top:flags.top||'50',skip:flags.skip||'0',...(flags.search?{search:flags.search}:{}),...(flags.timeline?{timelineId:flags.timeline}:{})}),{token});}
  else if(command==='preview')result=await client.request('/plans',{method:'POST',token,body:JSON.parse(fs.readFileSync(flags.input,'utf8'))});
  else if(command==='apply') {
    if(!flags.plan || !/^[A-Za-z0-9_.:-]{8,128}$/.test(flags.key||''))throw new Error('Apply requires the saved --plan and an explicit stable --key (8-128 letters, digits, _, ., :, -). Reuse both after a lost response.');
    result=await client.request('/plans/'+generatedId(flags.plan,'--plan')+'/apply',{method:'POST',token,body:{},idempotencyKey:flags.key});
  }
  else if(command==='revoke')result=await client.request('/grants/'+generatedId(flags.id,'--id')+'/revoke',{method:'POST',token,backendAuth:flags['backend-auth'],body:{}});
  else if(command==='recovery')result=await client.request('/recovery',{method:'POST',token,backendAuth:flags['backend-auth'],body:{planId:generatedId(flags.plan,'--plan')}});
  else if(command==='export') {if(!flags.out)throw new Error('Export requires --out.');const data=await client.request('/exchange/'+positive(flags.timeline)+'/export',{token,binary:true});fs.writeFileSync(flags.out,data,{flag:'wx'});console.log(JSON.stringify({exportFile:path.resolve(flags.out),bytes:data.length}));return;}
  else if(command==='import-preview')result=await client.request('/exchange/'+positive(flags.timeline)+'/preview',{method:'POST',token,body:fs.readFileSync(flags.input),contentType:'application/zip'});
  else throw new Error('Unknown client command.');
  const serialized=JSON.stringify(result,null,2)+'\n';if(flags.out)fs.writeFileSync(flags.out,serialized,{flag:'wx'});else process.stdout.write(serialized);
}
function generatedId(value,label){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new Error(label+' must be a generated UUID from the saved gateway result.');return value.toLowerCase();}
function positive(value){if(!/^\d+$/.test(value)||Number(value)<1)throw new Error('A positive content ID is required.');return value;}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(`${error.code||'client_error'}: ${error.message}`);process.exitCode=1;});
