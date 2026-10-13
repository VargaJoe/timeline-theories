'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const local=require('./m0-local-api.cjs');const {authenticate}=require('./m0-oidc-smoke.cjs');const {permissions,READ_PERMISSIONS}=require('./m0-acl.cjs');
const TIMELINES='/Root/Content/timelines/Timelines';const LIBRARY='/Root/Content/timelines/MediaLibrary';
const VISITOR='/Root/IMS/BuiltIn/Portal/Visitor';
function references(value){return Array.isArray(value)?value:value?.Id?[value]:[];}
function denied(response){return [401,403,404].includes(response.status)||(response.status===500&&response.value?.error?.code==='NotEnoughPermissions')||(response.status===400&&response.value?.error?.code==='RequestError'&&response.value?.error?.exceptiontype==='SenseNetSecurityException');}
async function smoke(){
  fs.writeFileSync(path.join(local.ROOT,'reference-privacy-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),passed:false,status:'started'},null,2));
  const accounts=local.readAccounts();const roles=[{name:'Visitor',identity:VISITOR},{name:'OIDC reader',identity:accounts.reader.path,account:{token:(await authenticate('reader')).token}},{name:'OIDC editor',identity:accounts.editor.path,account:{token:(await authenticate('editor')).token}}];
  const name='m0-reference-'+crypto.randomUUID();const checks=[];const own=[];let report;
  const sourceIds=new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8')).idMap));
  async function sourceCount(){const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:'+InTree:/Root/Content/timelines .AUTOFILTERS:OFF .LIFESPAN:OFF',$top:'0',$inlinecount:'allpages',metadata:'no'}),{account:accounts.admin});assert.equal(response.status,200);const raw=response.value.d.__count;assert.ok(typeof raw==='number'||(typeof raw==='string'&&/^\d+$/.test(raw)));const count=Number(raw);assert.ok(Number.isInteger(count)&&count>=0);return count;}
  const initialCount=await sourceCount();
  const record=(name,detail={})=>checks.push({name,...detail,passed:true});
  async function expanded(entry,account,allFields=false){const query={$expand:'MediaItem',metadata:'no'};if(!allFields)query.$select='Id,DisplayName,MediaItem/Id,MediaItem/DisplayName,MediaItem/Description';return local.request(local.endpoint(entry)+'?'+new URLSearchParams(query),{account});}
  function assertRedacted(response,role,label){if(response.status===200){const references=response.value.d.MediaItem;assert.ok(references==null||(Array.isArray(references)&&references.length===0),`${role} protected media reference was expanded by ${label}.`);record(`${role} ${label} protected media is redacted`,{status:response.status,referenceCount:references?.length??0});}else{assert.ok(denied(response),`${role} protected reference ${label} HTTP ${response.status}`);record(`${role} ${label} protected media is denied`,{status:response.status});}}
  function hasProtectedField(value){if(!value||typeof value!=='object')return false;return Object.entries(value).some(([key,item])=>['DisplayName','Description','CoverImageBin','ExternalLinks','ReleaseDate'].includes(key)||hasProtectedField(item));}
  try{
    for(const [type,parent,handler] of [['TimelineEntry','GenericContent','TimelineEntrySecurityHandler'],['MediaItem','GenericContent','MediaItemSecurityHandler'],['BookMediaItem','GenericContent/MediaItem','MediaItemSecurityHandler'],['Timeline','GenericContent/Folder','TimelineSecurityHandler']]){
      const schema=await local.api('/Root/System/Schema/ContentTypes/'+parent+'/'+type,{account:accounts.admin,query:{$select:'Id'}});
      const response=await local.request(`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${schema.Id}&propertyname=Binary`,{account:accounts.admin});assert.equal(response.status,200);
      const xml=response.bytes.toString('utf8');assert.ok(xml.includes(`handler="Timeline.Theories.M0.Security.${handler}"`),'Persisted domain handler differs from the reviewed runtime.');
      if(type==='TimelineEntry')assert.match(xml,/<Field\s+name="MediaItem"\s+type="Reference"\s*>/);
      if(type==='MediaItem')assert.match(xml,/<Field\s+name="MediaType"\s+type="Choice"\s*>/);
      record(`Persisted ${type} schema retains its stock fields and reviewed content handler`);
    }
    const media=await local.api(LIBRARY,{method:'POST',account:accounts.admin,query:{metadata:'no'},body:{__ContentType:'MediaItem',Name:name,DisplayName:'M0 reference ACL fixture',Description:'Local UUID reference privacy fixture '+name,MediaType:['movie']}});own.push({id:media.Id,name:media.Name,path:media.Path});
    const cover=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=','base64');
    await local.upload(LIBRARY,{name:media.Name,contentType:'MediaItem',contentId:media.Id,field:'CoverImageBin',bytes:cover,mime:'image/png',account:accounts.admin});
    const blockedTarget=await local.api(LIBRARY,{method:'POST',account:accounts.admin,query:{metadata:'no'},body:{__ContentType:'BookMediaItem',Name:name+'-blocked-target',DisplayName:'M0 unreadable replacement fixture',MediaType:['book'],BookSeriesNumber:1,PublicationYear:2000}});own.push({id:blockedTarget.Id,name:blockedTarget.Name,path:blockedTarget.Path});
    const timeline=await local.api(TIMELINES,{method:'POST',account:accounts.admin,query:{metadata:'no'},body:{__ContentType:'Timeline',Name:name,IsVisible:true}});own.push({id:timeline.Id,name:timeline.Name,path:timeline.Path});
    const entry=await local.api(timeline.Id,{method:'POST',account:accounts.admin,query:{metadata:'no'},body:{__ContentType:'TimelineEntry',Name:'entry',Position:1}});
    assert.equal(references((await expanded(entry.Id,accounts.admin)).value.d.MediaItem).length,0);
    await local.api(entry.Id,{method:'PATCH',account:accounts.admin,body:{MediaItem:[media.Id]}});
    assert.equal(references((await expanded(entry.Id,accounts.admin)).value.d.MediaItem)[0]?.Id,media.Id);
    record('Two-pass restore path permits an omitted reference, then restores the explicit raw relation');
    for(const [type,target] of [['MediaItem',media.Id],['BookMediaItem',blockedTarget.Id],['Timeline',timeline.Id],['TimelineEntry',entry.Id]]){const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:`+Id:${target} .AUTOFILTERS:OFF .LIFESPAN:OFF`,$select:'Id,Type,Path'}),{account:accounts.admin});assert.equal(response.status,200);assert.equal(response.value.d.results.length,1);assert.equal(response.value.d.results[0].Id,target);assert.equal(response.value.d.results[0].Type,type);assert.ok(response.value.d.results[0].Path.startsWith('/Root/Content/timelines/'));record(`Actual first-create ${type} retains its searchable ID and canonical Path`);}
    await permissions(media.Id,roles.map(role=>({identity:role.identity,...READ_PERMISSIONS})));
    for(const role of roles){const response=await expanded(entry.Id,role.account);assert.equal(response.status,200,`${role.name} baseline expand HTTP ${response.status}`);assert.equal(references(response.value.d.MediaItem)[0]?.Id,media.Id);assert.equal(references(response.value.d.MediaItem)[0]?.Description,media.Description,'Readable reference description differs from the local fixture.');record(`${role.name} can expand a readable media reference`);}
    for(const role of roles){const response=await local.request(`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${media.Id}&propertyname=CoverImageBin`,{account:role.account});assert.equal(response.status,200);assert.deepEqual(response.bytes,cover);record(`${role.name} reads the actual fixture binary before Open revocation`);}
    for(const role of roles){const response=await local.request(local.endpoint(blockedTarget.Id)+'?'+new URLSearchParams({$select:'Id,Type,DisplayName'}),{account:role.account});assert.equal(response.status,200);assert.equal(response.value.d.Type,'BookMediaItem');assert.equal(response.value.d.Id,blockedTarget.Id);record(`${role.name} reads the actual BookMediaItem type before Open revocation`);}
    await local.api(entry.Id,{method:'PATCH',account:roles[2].account,body:{MediaItem:[blockedTarget.Id]}});
    assert.equal(references((await expanded(entry.Id,accounts.admin)).value.d.MediaItem)[0]?.Id,blockedTarget.Id);
    await local.api(entry.Id,{method:'PATCH',account:roles[2].account,body:{MediaItem:[media.Id]}});
    record('Editor explicit writes to readable replacement and original references succeed');
    // Save implies Open in this SDK: explicitly use a read-only row before
    // denying Open, so the test revokes effective read instead of a cosmetic bit.
    await permissions(media.Id,roles.map(role=>({identity:role.identity,...READ_PERMISSIONS,Open:'deny',OpenMinor:'deny'})));
    await permissions(blockedTarget.Id,roles.map(role=>({identity:role.identity,...READ_PERMISSIONS,Open:'deny',OpenMinor:'deny'})));
    const rejectedCreate=await local.request(local.endpoint(timeline.Id),{method:'POST',account:roles[2].account,body:{__ContentType:'TimelineEntry',Name:'blocked-entry',MediaItem:[blockedTarget.Id]}});assert.ok(denied(rejectedCreate),`Editor incoming denied reference POST HTTP ${rejectedCreate.status}`);assert.equal((await local.request(local.endpoint(timeline.Path+'/blocked-entry'),{account:accounts.admin})).status,404,'Denied incoming reference POST persisted an invalid entry.');record('Denied incoming reference POST persists no invalid entry',{status:rejectedCreate.status});
    for(const role of roles){
      if(role.account){const permission=await local.request(local.endpoint(media.Id)+'/HasPermission?'+new URLSearchParams({permissions:'Open'}),{account:role.account});if(permission.status===200)assert.equal(permission.value.d,false);else assert.ok(denied(permission),`${role.name} native permission endpoint deny HTTP ${permission.status}`);record(`${role.name} target Open is false or native read gate denies the permission endpoint`,{status:permission.status,code:permission.value?.error?.code});}
      const direct=await local.request(local.endpoint(media.Id)+'?$select=Id,DisplayName,Description',{account:role.account});assert.ok(denied(direct),`${role.name} direct protected read HTTP ${direct.status}`);record(`${role.name} direct media read is denied`,{status:direct.status});
      const binary=await local.request(`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${media.Id}&propertyname=CoverImageBin`,{account:role.account});assert.ok(denied(binary),`${role.name} protected media binary HTTP ${binary.status}`);record(`${role.name} actual protected media binary is denied`,{status:binary.status});
      const collection=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:`+Id:${media.Id} .AUTOFILTERS:OFF .LIFESPAN:OFF`,$select:'Id,DisplayName,Description',metadata:'no'}),{account:role.account});if(collection.status===200)assert.equal(collection.value.d.results.length,0,'Collection query returned an Open-denied target.');else assert.ok(denied(collection),`${role.name} collection read HTTP ${collection.status}`);record(`${role.name} collection read fails closed on an Open-denied target`,{status:collection.status});
      for(const target of [media.Id,blockedTarget.Id]){const idOnly=await local.request(local.endpoint(target)+'?$select=Id',{account:role.account});assert.ok(denied(idOnly),`${role.name} denied media Id-only probe HTTP ${idOnly.status}`);const all=await local.request(local.endpoint(target),{account:role.account});assert.ok(denied(all),`${role.name} denied media all-field read HTTP ${all.status}`);record(`${role.name} ${target===media.Id?'MediaItem':'BookMediaItem'} Id-only and all-field reads are denied`,{idStatus:idOnly.status,allStatus:all.status});}
      assertRedacted(await expanded(entry.Id,role.account),role.name,'selected expansion');
      assertRedacted(await expanded(entry.Id,role.account,true),role.name,'all-field expansion including binary metadata');
      const selected=await local.request(local.endpoint(entry.Id)+'?'+new URLSearchParams({$select:'MediaItem',metadata:'no'}),{account:role.account});if(selected.status===200){assert.equal(hasProtectedField(selected.value.d.MediaItem),false,`${role.name} non-expanded reference contains protected fields.`);}else assert.ok(denied(selected));record(`${role.name} selected reference without expansion discloses no protected fields`,{status:selected.status});
      const navigated=await local.request(local.endpoint(entry.Id)+'/MediaItem?'+new URLSearchParams({$select:'Id,DisplayName,Description,CoverImageBin',metadata:'no'}),{account:role.account});if(navigated.status===200){assert.equal(hasProtectedField(navigated.value),false,`${role.name} reference navigation discloses protected fields.`);}else assert.ok(denied(navigated));record(`${role.name} direct reference navigation discloses no protected fields`,{status:navigated.status});
      const write=await local.request(local.endpoint(entry.Id),{method:'PATCH',account:role.account,body:{MediaItem:[blockedTarget.Id]}});assert.ok(denied(write),`${role.name} reference write to an unreadable target HTTP ${write.status}`);record(`${role.name} reference write to an unreadable replacement is denied`,{status:write.status});
    }
    const raw=await expanded(entry.Id,accounts.admin);assert.equal(raw.status,200);assert.equal(references(raw.value.d.MediaItem)[0]?.Id,media.Id);record('Denied reference writes preserve the original raw relation');
    for(const value of [null,[]]){const response=await local.request(local.endpoint(entry.Id),{method:'PATCH',account:roles[2].account,body:{MediaItem:value}});assert.ok(denied(response),`Editor explicit empty reference write HTTP ${response.status}`);assert.equal(references((await expanded(entry.Id,accounts.admin)).value.d.MediaItem)[0]?.Id,media.Id);record(`Editor explicit ${value===null?'null':'empty'} reference write is denied without clearing the relation`,{status:response.status});}
    // A scalar entry update must not erase a temporarily unreadable stored
    // reference. The actual raw relation is checked again after restoring read.
    await local.api(entry.Id,{method:'PATCH',account:roles[2].account,body:{Notes:'Unrelated scalar update while referenced media Open is denied'}});record('Editor unrelated entry update succeeds without media read');
    const query=new URLSearchParams({query:`+Id:${entry.Id} +MediaItem:${media.Id} .AUTOFILTERS:OFF .LIFESPAN:OFF`,$select:'Id',metadata:'no'});let indexed=false;const deadline=Date.now()+10000;while(Date.now()<deadline){const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+query,{account:accounts.admin});assert.equal(response.status,200);if(response.value.d.results.some(item=>item.Id===entry.Id)){indexed=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}assert.equal(indexed,true,'Unreadable-reference scalar save erased the indexed relation.');record('Unrelated scalar update retains the searchable raw reference ID');
    await permissions(media.Id,roles.map(role=>({identity:role.identity,...READ_PERMISSIONS})));
    for(const role of roles){const response=await expanded(entry.Id,role.account);assert.equal(response.status,200);assert.equal(references(response.value.d.MediaItem)[0]?.Id,media.Id);assert.equal(references(response.value.d.MediaItem)[0]?.Description,media.Description,'Readable reference description differs after restoring local read.');record(`${role.name} reference and protected fields return after actual read grant`);}
    for(const permanent of [false,true])for(const type of ['MediaItem','BookMediaItem','Timeline','TimelineEntry']){
      const fixtureName=name+'-delete-'+(permanent?'permanent':'normal')+'-'+type.toLowerCase();
      const parent=type==='TimelineEntry'?timeline.Id:type==='Timeline'?TIMELINES:LIBRARY;
      const fields=type==='TimelineEntry'?{MediaItem:[media.Id]}:type==='BookMediaItem'?{MediaType:['book'],PublicationYear:2000,BookSeriesNumber:1}:type==='MediaItem'?{MediaType:['movie']}:{};
      const created=await local.api(parent,{method:'POST',account:roles[2].account,query:{metadata:'no'},body:{__ContentType:type,Name:fixtureName,...fields}});assert.equal(created.Type,type);assert.equal(created.Name,fixtureName);
      const fixture={id:created.Id,name:created.Name,path:created.Path};own.push(fixture);assert.ok(!sourceIds.has(fixture.id));
      const response=await local.request(local.endpoint(created.Id)+(permanent?'?permanent=true':''),{method:'DELETE',account:roles[2].account});assert.ok(response.status>=200&&response.status<300,`Editor ${permanent?'permanent':'normal'} ${type} DELETE HTTP ${response.status}`);
      assert.equal((await local.request(local.endpoint(created.Path),{account:accounts.admin})).status,404,'Deleted UUID fixture remained in its original canonical path.');
      const after=await local.request(local.endpoint(created.Id)+'?'+new URLSearchParams({$select:'Id,Name,Path',metadata:'no'}),{account:accounts.admin});
      if(after.status===404)own.splice(own.indexOf(fixture),1);else{assert.equal(after.status,200);assert.equal(after.value.d.Id,fixture.id);assert.equal(after.value.d.Name,fixture.name);assert.ok(after.value.d.Path!==fixture.path&&!after.value.d.Path.startsWith('/Root/Content/timelines/'),'Normal delete did not leave the project scope.');fixture.path=after.value.d.Path;}
      record(`Editor actual first-create and ${permanent?'permanent':'normal'} Delete succeed for ${type}`,{status:response.status,afterStatus:after.status});
    }
    for(const [type,target] of [['TimelineEntry',entry.Id],['Timeline',timeline.Id]]){
      await permissions(target,roles.map(role=>({identity:role.identity,...READ_PERMISSIONS,Open:'deny',OpenMinor:'deny'})));
      for(const role of roles){for(const select of ['Id','Id,DisplayName,Description',undefined]){const response=await local.request(local.endpoint(target)+(select?'?'+new URLSearchParams({$select:select}):''),{account:role.account});assert.ok(denied(response),`${role.name} ${type} direct read HTTP ${response.status}`);}record(`${role.name} ${type} Id-only, selected and all-field reads are denied`);}
    }
    report={version:1,ranAt:new Date().toISOString(),repository:local.REPOSITORY,authentication:'Actual Visitor and authorization-code PKCE reader/editor, each verified GetCurrentUser.',checks};return report;
  }catch(error){fs.writeFileSync(path.join(local.ROOT,'reference-privacy-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),checks,passed:false,error:error.message},null,2));console.error(JSON.stringify({completedChecks:checks.map(check=>check.name),failure:error.message}));throw error;}
  finally{
    const cleanup=[];
    try{
      for(const fixture of own.reverse()){
        assert.ok(Number.isInteger(fixture.id)&&!sourceIds.has(fixture.id)&&fixture.name.startsWith(name),'Cleanup fixture ownership failed.');
        const actual=await local.api(fixture.id,{account:accounts.admin,query:{$select:'Id,Name,Path',metadata:'no'}});assert.equal(actual.Id,fixture.id);assert.equal(actual.Name,fixture.name);assert.equal(actual.Path,fixture.path);
        await local.api(fixture.id,{method:'DELETE',account:accounts.admin,query:{permanent:'true'}});assert.equal((await local.request(local.endpoint(fixture.id),{account:accounts.admin})).status,404);cleanup.push({id:fixture.id,deleted:true});
      }
      const finalCount=await sourceCount();assert.equal(finalCount,initialCount,'UUID fixture cleanup changed project record count.');
      if(report){Object.assign(report,{cleanup,initialCount,finalCount,passed:true});fs.writeFileSync(path.join(local.ROOT,'reference-privacy-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:checks.length,cleaned:cleanup.length,initialCount,finalCount}));}
    }catch(error){fs.writeFileSync(path.join(local.ROOT,'reference-privacy-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),checks,cleanup,initialCount,passed:false,error:'UUID cleanup or source count verification failed.'},null,2));throw error;}
  }
}
module.exports={smoke};if(require.main===module)smoke().catch(error=>{console.error(error.message);process.exitCode=1;});
