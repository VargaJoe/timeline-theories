import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { DomainError, validatePublicUrl } from '../domain/content.mjs';
export const DEFAULT_COVER_ORIGINS = ['https://image.tmdb.org','https://covers.openlibrary.org','https://books.google.com','https://m.media-amazon.com','https://images-na.ssl-images-amazon.com'];
export function coverOrigins(extra = '') {
  const origins=new Set(DEFAULT_COVER_ORIGINS);
  for(const value of extra.split(',').map(v=>v.trim()).filter(Boolean)){const url=validatePublicUrl(value);if(url.pathname!=='/'||url.search||url.hash)throw new DomainError('invalid_configuration','Cover allowlist entries must be HTTPS origins.',503);origins.add(url.origin);}
  return origins;
}
export function publicAddress(address) {
  if(net.isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);}
  return net.isIP(address)===6 && /^[23]/i.test(address) && !/^2001:db8:/i.test(address);
}
export async function fetchPublicCover(value,{origins=coverOrigins(),beforeFetch=async()=>{},maxBytes=10*1024*1024,timeoutMs=12000}={}) {
  const deadline=Date.now()+timeoutMs;
  const url=validatePublicUrl(value);
  if(!origins.has(url.origin))throw new DomainError('cover_origin_denied','Cover origin is outside the configured public-image allowlist.',403);
  await beforeFetch();
  let addresses,dnsTimer;try{addresses=await Promise.race([dns.lookup(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new Error()),Math.max(1,deadline-Date.now()));})]);}catch{throw new DomainError('cover_transport','Cover DNS lookup failed or timed out.',502);}finally{clearTimeout(dnsTimer);}
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new DomainError('cover_origin_denied','Cover origin resolved to a restricted network address.',403);
  await beforeFetch();
  return await new Promise((resolve,reject)=>{
    // Pin this socket to the validated result; DNS is not re-resolved after
    // checking. TLS still verifies the original provider hostname.
    const address=addresses[0];
    const req=https.request(url,{method:'GET',headers:{Accept:'image/png,image/jpeg,image/webp'},lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family)},res=>{
      if(res.statusCode!==200){res.resume();reject(new DomainError('cover_transport','Cover fetch failed or redirected.',502));return;}
      const contentType=res.headers['content-type']?.split(';')[0];
      if(!['image/png','image/jpeg','image/webp'].includes(contentType)){res.resume();reject(new DomainError('invalid_cover','Unsupported public-cover media type.',502));return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes)req.destroy(new DomainError('cover_limit','Cover exceeds the byte limit.',413));else chunks.push(chunk);});
      res.on('end',()=>resolve({data:Buffer.concat(chunks),contentType}));
    });
    const timer=setTimeout(()=>req.destroy(new DomainError('cover_timeout','Cover fetch timed out.',502)),Math.max(1,deadline-Date.now()));
    req.on('close',()=>clearTimeout(timer));req.on('error',error=>reject(error instanceof DomainError?error:new DomainError('cover_transport','Public-cover transport failed.',502)));req.end();
  });
}
