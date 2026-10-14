'use strict';
// Netlify owns the SPA origin; this bounded adapter forwards only the native
// application API to one operator-configured HTTPS gateway. No backend secret
// or owner token is introduced by this proxy.
exports.handler = async event => {
  const value = process.env.TIMELINE_GATEWAY_ORIGIN;
  let origin;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.port && parsed.port !== '443' || /^(localhost|.*\.localhost|.*\.local)$/i.test(parsed.hostname) || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) throw new Error();
    origin = parsed.origin;
  } catch { return {statusCode:503,body:JSON.stringify({error:{code:'gateway_unconfigured',message:'The native HTTPS gateway is not configured.'}})}; }
  const prefix = '/.netlify/functions/native-api';
  const pathname = event.path.startsWith(prefix) ? event.path.slice(prefix.length) : event.path.startsWith('/api/v1/') ? event.path.slice('/api/v1'.length) : '';
  if (!pathname.startsWith('/') || pathname.includes('..') || pathname.includes('//') || !['GET','POST','OPTIONS'].includes(event.httpMethod)) return {statusCode:404,body:'{}'};
  const headers = {Accept:event.headers.accept || 'application/json'};
  for (const key of ['authorization','content-type','idempotency-key','x-timeline-repository','x-timeline-authority','x-timeline-project','x-timeline-backend-auth','x-timeline-client-origin','origin']) if (event.headers[key]) headers[key]=event.headers[key];
  const body = event.body ? Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8') : undefined;
  // The deployed function is a small-message adapter; direct gateway access
  // retains the gateway's larger archive limits.
  if (body?.length > 4 * 1024 * 1024) return {statusCode:413,body:JSON.stringify({error:{code:'proxy_input_limit',message:'Use the direct gateway for payloads over 4 MiB.'}})};
  try {
    const response = await fetch(origin+'/api/v1'+pathname+(event.rawQuery?'?'+event.rawQuery:''),{method:event.httpMethod,headers,body,redirect:'error',signal:AbortSignal.timeout(25000)});
    const chunks=[];let size=0;
    if(response.body)for await (const chunk of response.body) {size+=chunk.length;if(size>4*1024*1024)throw new Error();chunks.push(Buffer.from(chunk));}
    const bytes=Buffer.concat(chunks),contentType=response.headers.get('content-type') || 'application/json';
    const binary=!contentType.includes('json');
    return {statusCode:response.status,headers:{'Content-Type':contentType,'Cache-Control':'no-store',...(response.headers.has('x-timeline-skipped-covers')?{'X-Timeline-Skipped-Covers':response.headers.get('x-timeline-skipped-covers')}: {})},body:bytes.toString(binary?'base64':'utf8'),isBase64Encoded:binary};
  } catch {return {statusCode:502,body:JSON.stringify({error:{code:'gateway_transport',message:'Native gateway is unavailable or exceeds the proxy response limit.'}})};}
};
