'use strict';
const fs=require('node:fs');const path=require('node:path');
const local=require('./m0-local-api.cjs');
const ROOT='/Root/Content/timelines';
const VISITOR='/Root/IMS/BuiltIn/Portal/Visitor';
const READ_PERMISSIONS={See:'allow',Open:'allow',OpenMinor:'allow',SeePermissions:'allow',Save:'deny',AddNew:'deny',Delete:'deny',SetPermissions:'deny'};
const WRITE_PERMISSIONS={See:'allow',Open:'allow',OpenMinor:'allow',SeePermissions:'allow',Save:'allow',AddNew:'allow',Delete:'allow'};
const READ_FIELDS=['See','Preview','PreviewWithoutWatermark','PreviewWithoutRedaction','Open','OpenMinor','SeePermissions'];
async function permissions(target,rows) {return local.api(target,{operation:'SetPermissions',method:'POST',body:{r:rows},account:local.readAccounts().admin});}
async function secureTimelineContainer(target,{publicTimelineIds=[]}={}) {
  if(!target.startsWith('/Root/Content/'))throw new Error('Local timeline container must be under /Root/Content.');
  const accounts=local.readAccounts();const readers=[VISITOR,accounts.reader.path];
  // Explicit public grants precede removing inherited public grants. The
  // container stays readable through local-only grants; new children do not.
  for(const id of publicTimelineIds)await permissions(id,readers.map(identity=>({identity,...READ_PERMISSIONS})));
  await local.api(target,{operation:'SetPermissions',method:'POST',body:{inheritance:'break'},account:accounts.admin});
  const acl=await local.api(target,{operation:'GetAcl',account:accounts.admin});
  if(acl.inherits!==false)throw new Error('Timeline container inheritance did not break; refusing insecure setup.');
  await permissions(target,readers.map(identity=>({identity,localOnly:false,...Object.fromEntries(READ_FIELDS.map(field=>[field,'undefined'])),Save:'deny',AddNew:'deny',Delete:'deny',SetPermissions:'deny'})));
  await permissions(target,readers.map(identity=>({identity,localOnly:true,...READ_PERMISSIONS})));
  await permissions(target,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
}
async function configureAcl(directory) {
  const source=JSON.parse(fs.readFileSync(path.join(directory,'contents.json'),'utf8'));
  const journal=JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8'));
  if(!journal.completed)throw new Error('ACL exposure requires a verified completed restore.');
  const accounts=local.readAccounts();
  for(const role of ['editor','reader'])if(!accounts[role].apiKey){const token=await local.api(accounts[role].path,{operation:'CreateApiKey',method:'POST',body:{},account:accounts.admin});accounts[role].apiKey=token.Value;}
  fs.writeFileSync(path.join(local.ROOT,'accounts.json'),JSON.stringify(accounts,null,2));
  // Keep both nonwriters closed until all private descendants are secured.
  await permissions(ROOT,[VISITOR,accounts.reader.path].map(identity=>({identity,See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'})));
  await permissions(ROOT,[{identity:accounts.editor.path,...WRITE_PERMISSIONS}]);
  const privateTimelineIds=new Set(source.filter(x=>x.type==='Timeline' && (x.fields.IsVisible!==true || x.fields.Hidden)).map(x=>x.id));
  const privatePaths=source.filter(x=>privateTimelineIds.has(x.id)).map(x=>x.path);
  const publicMedia=new Set();const privateMedia=new Set();
  for(const entry of source.filter(x=>x.type==='TimelineEntry')) {const isPrivate=privatePaths.some(p=>entry.path.startsWith(p+'/'));for(const id of entry.fields.MediaItem || [])(isPrivate?privateMedia:publicMedia).add(id);}
  const exclusivePrivateMedia=[...privateMedia].filter(id=>!publicMedia.has(id));
  const secured=[...privateTimelineIds,...exclusivePrivateMedia];
  for(const id of secured)await permissions(journal.idMap[id],[{identity:VISITOR,See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'},{identity:accounts.reader.path,See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'}]);
  await secureTimelineContainer(ROOT+'/Timelines',{publicTimelineIds:source.filter(x=>x.type==='Timeline'&&!privateTimelineIds.has(x.id)).map(x=>journal.idMap[x.id])});
  // Public browsing rights are granted only after every protected root and cover is secured.
  await permissions(ROOT,[VISITOR,accounts.reader.path].map(identity=>({identity,...READ_PERMISSIONS})));
  const typeRoot='/Root/System/Schema/ContentTypes';
  await permissions(typeRoot,[{identity:VISITOR,See:'allow',Open:'allow',SeePermissions:'allow',AddNew:'deny',Save:'deny'},{identity:accounts.reader.path,See:'allow',Open:'allow',SeePermissions:'allow',AddNew:'deny',Save:'deny'},{identity:accounts.editor.path,See:'allow',Open:'allow',SeePermissions:'allow',AddNew:'deny',Save:'deny'}]);
  const report={version:2,configuredAt:new Date().toISOString(),privateTimelines:privateTimelineIds.size,exclusivePrivateMedia:exclusivePrivateMedia.length,securedSourceIds:secured,roles:{visitor:'public read only',reader:'authenticated public read only',editor:'project read/edit/create/delete'},policy:'Local identities and local ACL only; production ACL/identity not copied. Hidden timelines are private. Shared media remains public if used by a public timeline. Timelines container breaks inheritance; reader access is localOnly, public timelines explicitly propagate read rights, new children start private.'};
  fs.writeFileSync(path.join(local.ROOT,'acl-policy.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({privateTimelines:privateTimelineIds.size,exclusivePrivateMedia:exclusivePrivateMedia.length,roles:Object.keys(report.roles)}));return report;
}
module.exports={configureAcl,secureTimelineContainer,permissions,READ_PERMISSIONS,WRITE_PERMISSIONS};
if(require.main===module)configureAcl(path.resolve(process.argv[2]||'')).catch(error=>{console.error(error.message);process.exitCode=1;});
