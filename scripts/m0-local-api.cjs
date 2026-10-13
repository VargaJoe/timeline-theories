'use strict';
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const ROOT = path.resolve(__dirname, '../deployment/.local');
const REPOSITORY = 'https://localhost:41016';
const AUTHORITY = 'https://localhost:41017';
function assertLocal(url) {
  const target = new URL(url);
  if (!['https:'].includes(target.protocol) || target.hostname !== 'localhost' || !['41016','41017'].includes(target.port) || target.username || target.password) throw new Error('Local M0 endpoint guard rejected URL.');
  return target;
}
function request(url, {method = 'GET', headers = {}, body, account} = {}) {
  const target = assertLocal(url);
  const ca = fs.readFileSync(path.join(ROOT, 'certificates/localhost.pem'));
  if (account?.apiKey) headers = {...headers, ApiKey: account.apiKey};
  if (account?.token) headers = {...headers, Authorization: `Bearer ${account.token}`};
  if (body && typeof body !== 'string' && !Buffer.isBuffer(body)) {body = JSON.stringify(body); headers = {...headers, 'Content-Type':'application/json'};}
  return new Promise((resolve, reject) => {
    const req = https.request(target, {method, ca, headers}, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const bytes = Buffer.concat(chunks); let value; try {value = JSON.parse(bytes.toString('utf8'));} catch {value = bytes.toString('utf8');} resolve({status: res.statusCode, headers:res.headers, value, bytes}); });
    });
    req.setTimeout(60000, () => req.destroy(new Error('Local M0 request timed out.')));
    req.on('error', reject); if(body) req.write(body); req.end();
  });
}
function endpoint(contentPath) {
  if (Number.isInteger(contentPath)) return `${REPOSITORY}/OData.svc/content(${contentPath})`;
  if (contentPath === '/Root') return `${REPOSITORY}/OData.svc/('Root')`;
  if (!contentPath.startsWith('/Root') || contentPath.includes('..')) throw new Error('Local content path rejected.');
  const slash = contentPath.lastIndexOf('/');
  const segments = contentPath.slice(0,slash).split('/').map(encodeURIComponent).join('/');
  return `${REPOSITORY}/OData.svc${segments}('${encodeURIComponent(contentPath.slice(slash+1).replaceAll("'", "''")).replaceAll("'", '%27')}')`;
}
async function api(contentPath, {operation, query, ...options} = {}) {
  let url = endpoint(contentPath); if(operation) url += '/' + operation;
  if(query) url += '?' + new URLSearchParams(query);
  const result = await request(url, options);
  if (result.status < 200 || result.status >= 300) {
    const error = new Error(`Local ${options.method || 'GET'} ${operation || contentPath}: HTTP ${result.status}: ${result.value?.error?.message?.value || result.value?.error?.message || result.value?.Message || ''}`);
    error.status = result.status; throw error;
  }
  return result.value?.d ?? result.value;
}
const readAccounts = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'accounts.json'), 'utf8'));
async function upload(parentPath, {name, bytes, contentType = 'File', field = 'Binary', contentId, mime = 'application/octet-stream', account}) {
  const boundary = 'm0-' + require('node:crypto').randomBytes(16).toString('hex');
  const chunks = [];
  for (const [key,value] of Object.entries({ChunkToken:'0*0*False*False',FileName:name,Overwrite:'true',PropertyName:field,FileLength:bytes.length,ContentType:contentType,...(contentId?{ContentId:contentId}:{})})) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
  if (/[/\\"\r\n]/.test(name)) throw new Error('Unsafe upload name.');
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  const result = await request(endpoint(parentPath)+'/Upload', {method:'POST',headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`},body:Buffer.concat(chunks),account});
  if(result.status<200 || result.status>=300) throw new Error(`Local upload ${contentType}/${field}: HTTP ${result.status}: ${result.value?.error?.message?.value || ''}`);
  return result.value;
}
module.exports = {ROOT, REPOSITORY, AUTHORITY, assertLocal, request, endpoint, api, upload, readAccounts};
if(require.main === module) {
  (async () => {
    const deadline=Date.now()+120000;
    while(Date.now()<deadline){try{const result=await api('/Root',{account:readAccounts().admin,query:{$select:'Id',metadata:'no'}});if(Number.isInteger(result.Id)){console.log('Local repository is ready.');return;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
    throw new Error('Local repository readiness timed out.');
  })().catch(error => {console.error(error.message); process.exitCode=1;});
}
