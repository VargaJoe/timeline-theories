'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const local = require('./m0-local-api.cjs');
async function installSchemas() {
  const account = local.readAccounts().admin;
  const result = [];
  for(const [type,parent] of [['MediaItem','GenericContent'],['BookMediaItem','GenericContent/MediaItem'],['TimelineEntry','GenericContent'],['Timeline','GenericContent/Folder'],['ApiKeyStore','GenericContent']]) {
    const file = path.resolve(__dirname, `../deployment/contenttypes/${type}.xml`);
    await local.upload('/Root/System/Schema/ContentTypes/'+parent, {name:type,bytes:fs.readFileSync(file),contentType:'ContentType',mime:'text/xml',account});
    result.push({type,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
  }
  fs.writeFileSync(path.join(local.ROOT,'schema-migration-v1.json'),JSON.stringify({version:1,installedAt:new Date().toISOString(),schemas:result,policy:'Local only. Production enums plus aliases, optional Year and SeriesName, Rating 0..10/default0, BookSeriesNumber >=1. No value inference.'},null,2));
  return result;
}
async function ensureUser(name) {
  const admin = local.readAccounts().admin;
  let user;
  try {user = await local.api('/Root/IMS/BuiltIn/Portal/'+name,{account:admin,query:{$select:'Id,Name,Path,Type,LoginName'}});}
  catch(error) {if(error.status !== 404) throw error;}
  const accounts = local.readAccounts();
  const key = name === 'M0Editor'?'editor':'reader';
  const password = accounts[key]?.password || 'M0a!' + crypto.randomBytes(24).toString('hex');
  if (!user) user = await local.api('/Root/IMS/BuiltIn/Portal',{method:'POST',account:admin,body:{__ContentType:'User',Name:name,DisplayName:name,LoginName:name,Email:`${name.toLowerCase()}@localhost.invalid`,Password:password,Enabled:true}});
  accounts[key] = {...accounts[key],username:name,loginUsername:user.LoginName||name,password,id:user.Id,path:user.Path};
  fs.writeFileSync(path.join(local.ROOT,'accounts.json'),JSON.stringify(accounts,null,2));
  return accounts[key];
}
async function configureClient() {
  const clients = await local.api('/Root',{operation:'GetClients',account:local.readAccounts().admin});
  let client = clients.clients.find(x=>x.name==='timeline-theories-local');
  if (!client) client = await local.api('/Root',{operation:'CreateClient',method:'POST',body:{name:'timeline-theories-local',type:'ExternalSpa'},account:local.readAccounts().admin});
  const profile = path.resolve(__dirname,'../client/profiles/local.override.json');
  fs.writeFileSync(profile,JSON.stringify({clientId:client.clientId},null,2));
  return client.clientId;
}
async function provision() {
  const accounts=local.readAccounts();
  if(!accounts.admin.password){
    const password='M0a!'+crypto.randomBytes(24).toString('hex');
    await local.api('/Root/IMS/BuiltIn/Portal/Admin',{operation:'ChangePassword',method:'POST',body:{password},account:accounts.admin});
    accounts.admin.username='Admin';accounts.admin.password=password;
    fs.writeFileSync(path.join(local.ROOT,'accounts.json'),JSON.stringify(accounts,null,2));
  }
  const schema = await installSchemas();
  const editor = await ensureUser('M0Editor'); const reader = await ensureUser('M0Reader');
  const clientId = await configureClient();
  console.log(JSON.stringify({schemas:schema.map(x=>x.type),users:[{role:'editor',id:editor.id},{role:'reader',id:reader.id}],clientId,credentialsFile:'deployment/.local/accounts.json'}));
}
module.exports={installSchemas,ensureUser,configureClient,provision};
if(require.main===module) provision().catch(error=>{console.error(error.message);process.exitCode=1;});
