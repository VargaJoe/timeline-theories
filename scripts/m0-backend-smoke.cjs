'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const local=require('./m0-local-api.cjs');
async function ensure(parent,name,type,fields={}) {
  const account=local.readAccounts().admin;
  try{return await local.api(parent+'/'+name,{account,query:{metadata:'no'}});}catch(error){if(error.status!==404)throw error;}
  return local.api(parent,{method:'POST',account,query:{metadata:'no'},body:{__ContentType:type,Name:name,...fields}});
}
async function smoke() {
  const accounts=local.readAccounts();const fixture=await local.api('/Root/Content/timelines/Timelines',{account:accounts.admin,query:{$select:'Id,Path',metadata:'no'}});const prefix='m0-backend-'+crypto.randomUUID();const created=[];let report;
  try {
  const publicTimeline=await ensure(fixture.Path,prefix+'-public','Timeline',{IsVisible:true});created.push(publicTimeline.Id);
  const privateTimeline=await ensure(fixture.Path,prefix+'-private','Timeline',{IsVisible:false});created.push(privateTimeline.Id);
  // SelectionRoot requires references to live in the canonical MediaLibrary.
  const journal=JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8'));
  const source=JSON.parse(fs.readFileSync(path.join(journal.sourceDirectory,'contents.json'),'utf8'));
  const sourceMedia=source.find(x=>['MediaItem','BookMediaItem'].includes(x.type)&&journal.idMap[x.id]);
  if(!sourceMedia)throw new Error('The smoke requires at least one restored canonical MediaItem.');
  const media=await local.api(journal.idMap[sourceMedia.id],{account:accounts.admin,query:{$select:'Id,Path,Name',metadata:'no'}});
  const privateEntry=await ensure(privateTimeline.Path,'private-entry','TimelineEntry',{MediaItem:[media.Id],Position:1});
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=','base64');
  await local.upload(fixture.Path,{name:privateTimeline.Name,bytes:image,contentType:'Timeline',field:'CoverImageBin',contentId:privateTimeline.Id,mime:'image/png',account:accounts.admin});
  const checks=[];
  function nativeDenied(response){return [401,403,404].includes(response.status)||(response.status===500&&response.value?.error?.code==='NotEnoughPermissions')||(response.status===400&&response.value?.error?.code==='RequestError'&&response.value?.error?.exceptiontype==='SenseNetSecurityException');}
  async function denied(name,target,method='GET',account,body) {const response=await local.request(local.endpoint(target),{method,account,body});assert.ok(nativeDenied(response),`${name}: HTTP ${response.status}`);checks.push({name,status:response.status,...(response.value?.error?{code:response.value.error.code,exceptiontype:response.value.error.exceptiontype}:{}),passed:true});}
  const publicResult=await local.api(publicTimeline.Id,{query:{$select:'Id,DisplayName',metadata:'no'}});assert.equal(publicResult.Id,publicTimeline.Id);checks.push({name:'Visitor reads public timeline',passed:true});
  await denied('Visitor create is denied',publicTimeline.Id,'POST',undefined,{__ContentType:'TimelineEntry',Name:'must-not-create',MediaItem:[media.Id]});
  await denied('Visitor update is denied',publicTimeline.Id,'PATCH',undefined,{Description:'must-not-save'});
  await denied('Nonwriter update is denied',publicTimeline.Id,'PATCH',accounts.reader,{Description:'must-not-save'});
  await denied('Visitor private timeline is denied',privateTimeline.Id);
  await denied('Visitor private entry is denied',privateEntry.Id);
  await denied('Nonwriter private timeline is denied',privateTimeline.Id,'GET',accounts.reader);
  const binary=await local.request(`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${privateTimeline.Id}&propertyname=CoverImageBin`);assert.ok([401,403,404].includes(binary.status),`Private binary HTTP ${binary.status}`);checks.push({name:'Visitor private binary is denied',status:binary.status,passed:true});
  const editorOpen=await local.api(publicTimeline.Id,{operation:'HasPermission',query:{permissions:'Open,Save'},account:accounts.editor});assert.equal(editorOpen,true);checks.push({name:'Editor target permission is true',passed:true});
  const readerSave=await local.api(publicTimeline.Id,{operation:'HasPermission',query:{permissions:'Save'},account:accounts.reader});assert.equal(readerSave,false);checks.push({name:'Nonwriter target Save permission is false',passed:true});
  const visitorPermission=await local.request(local.endpoint(publicTimeline.Id)+'/HasPermission?permissions=Save');assert.equal(visitorPermission.status,403);checks.push({name:'Visitor authenticated-only permission endpoint fails closed',status:403,passed:true});
  const privateIdProbe=await local.request(local.endpoint(privateTimeline.Id)+'?$select=Id');assert.ok(nativeDenied(privateIdProbe));checks.push({name:'Visitor private Id-only read probe is denied',status:privateIdProbe.status,passed:true});
  const name='editor-crud-'+Date.now();
  const entry=await local.api(publicTimeline.Id,{method:'POST',account:accounts.editor,query:{metadata:'no'},body:{__ContentType:'TimelineEntry',Name:name,MediaItem:[media.Id],Position:7}});
  await local.api(entry.Id,{method:'PATCH',account:accounts.editor,query:{metadata:'no'},body:{Notes:'Real authorized edit',Position:8}});
  const edited=await local.api(entry.Id,{account:accounts.editor,query:{$select:'Notes,Position',metadata:'no'}});assert.equal(edited.Position,8);assert.equal(edited.Notes,'Real authorized edit');
  await local.api(entry.Id,{method:'DELETE',account:accounts.editor,query:{permanent:'true'}});checks.push({name:'Editor real create/update/read/delete succeeds',passed:true});
  report={ranAt:new Date().toISOString(),repository:local.REPOSITORY,checks,fixtureIds:{root:fixture.Id,publicTimeline:publicTimeline.Id,privateTimeline:privateTimeline.Id,privateEntry:privateEntry.Id,media:media.Id},passed:false};return report;
  }finally{try{const sourceIds=new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8')).idMap));for(const id of created.reverse()){const content=await local.api(id,{account:accounts.admin,query:{$select:'Id,Name,Path',metadata:'no'}});assert.ok(!sourceIds.has(id)&&content.Id===id&&content.Name.startsWith(prefix)&&content.Path===fixture.Path+'/'+content.Name,'UUID cleanup ownership failed.');await local.api(id,{method:'DELETE',account:accounts.admin,query:{permanent:'true'}});assert.equal((await local.request(local.endpoint(id),{account:accounts.admin})).status,404);}if(report){Object.assign(report,{passed:true,cleaned:created.length});fs.writeFileSync(path.join(local.ROOT,'backend-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:report.checks.length,cleaned:created.length}));}}catch(error){fs.writeFileSync(path.join(local.ROOT,'backend-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),passed:false,error:'UUID cleanup ownership or deletion failed.'},null,2));throw error;}}
}
module.exports={smoke};if(require.main===module)smoke().catch(error=>{console.error(error.message);process.exitCode=1;});
