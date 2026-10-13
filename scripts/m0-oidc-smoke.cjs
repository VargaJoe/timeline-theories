'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const local=require('./m0-local-api.cjs');
const decodeHtml=value=>value.replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&#39;',"'");
async function authenticate(role,{username}={}) {
  const account=local.readAccounts()[role];if(!account || !['editor','reader'].includes(role))throw new Error('Choose the local editor or reader role.');
  const client=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../client/profiles/local.override.json'),'utf8'));
  const verifier=crypto.randomBytes(32).toString('base64url');const state=crypto.randomBytes(16).toString('hex');
  const redirectUri='https://localhost:8080/authentication/callback';
  const params=new URLSearchParams({client_id:client.clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid profile sensenet',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',snrepo:local.REPOSITORY});
  const cookies=new Map();
  async function request(url,options={}){
    const response=await local.request(url,{...options,headers:{...options.headers,...(cookies.size?{Cookie:[...cookies].map(([key,value])=>`${key}=${value}`).join('; ')}:{})}});
    for(const cookie of response.headers['set-cookie']||[]){const pair=cookie.split(';')[0];const split=pair.indexOf('=');cookies.set(pair.slice(0,split),pair.slice(split+1));}
    return response;
  }
  let response=await request(local.AUTHORITY+'/connect/authorize?'+params);
  if(response.status!==302 || !response.headers.location)throw new Error(`Local ${role} authorize failed: HTTP ${response.status}.`);
  let url=new URL(response.headers.location,local.AUTHORITY).href;
  response=await request(url);
  if(response.status!==200)throw new Error(`Local ${role} login form failed: HTTP ${response.status}.`);
  const html=String(response.value);const form=new URLSearchParams();
  for(const input of html.matchAll(/<input\b[^>]*>/gi)){
    if(!/type="hidden"/i.test(input[0]))continue;
    const name=input[0].match(/name="([^"]*)"/i)?.[1];const value=input[0].match(/value="([^"]*)"/i)?.[1]||'';
    if(name)form.set(name,decodeHtml(value));
  }
  form.set('Username',username||account.loginUsername||account.username);form.set('Password',account.password);form.set('button','login');
  response=await request(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});
  if(response.status!==302)throw new Error(`Local ${role} credential login failed: HTTP ${response.status}${/invalid username or password/i.test(String(response.value))?' (invalid username or password)':''}.`);
  for(let count=0;count<8;count++){
    url=new URL(response.headers.location,local.AUTHORITY).href;
    if(url.startsWith(redirectUri+'?'))break;
    response=await request(url);
    if(response.status!==302 || !response.headers.location)throw new Error(`Local ${role} authorization continuation failed: HTTP ${response.status}.`);
  }
  const callback=new URL(url);if(callback.origin!=='https://localhost:8080' || callback.pathname!=='/authentication/callback' || callback.searchParams.get('state')!==state || !callback.searchParams.get('code'))throw new Error(`Local ${role} callback validation failed.`);
  response=await request(local.AUTHORITY+'/connect/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:client.clientId,redirect_uri:redirectUri,code:callback.searchParams.get('code'),code_verifier:verifier}).toString()});
  if(response.status!==200 || !response.value.access_token)throw new Error(`Local ${role} PKCE token exchange failed: HTTP ${response.status}.`);
  const token=response.value.access_token;const current=await local.api('/Root',{operation:'GetCurrentUser',account:{token}});
  if(current.Id!==account.id)throw new Error(`Local ${role} token resolved to an unexpected repository identity.`);
  return {role,id:current.Id,token,expiresAt:new Date(Date.now()+response.value.expires_in*1000).toISOString()};
}
async function main(){
  const roles=process.argv[2]?[process.argv[2]]:['reader','editor'];const tokens={};
  for(const role of roles){const result=await authenticate(role);tokens[role]=result;console.log(JSON.stringify({role,id:result.id,credentialLogin:true,pkceTokenExchange:true,repositoryIdentity:true}));}
  fs.writeFileSync(path.join(local.ROOT,'oidc-tokens.json'),JSON.stringify(tokens,null,2));
  fs.writeFileSync(path.join(local.ROOT,'oidc-smoke.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,checks:Object.values(tokens).map(({token,...result})=>({...result,credentialLogin:true,pkceTokenExchange:true,repositoryIdentity:true}))},null,2));
}
module.exports={authenticate};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
