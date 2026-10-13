'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const local=require('./m0-local-api.cjs');const {authenticate}=require('./m0-oidc-smoke.cjs');
const CONTAINER='/Root/Content/timelines/Timelines';
function isDenied(response){return [401,403,404].includes(response.status)||(response.status===500&&response.value?.error?.code==='NotEnoughPermissions')||(response.status===400&&response.value?.error?.code==='RequestError'&&response.value?.error?.exceptiontype==='SenseNetSecurityException');}
async function smoke(){
  const admin=local.readAccounts().admin;const editor={token:(await authenticate('editor')).token};const reader={token:(await authenticate('reader')).token};
  const prefix='m0-privacy-'+crypto.randomUUID();const created=[];const pendingNames=[];const checks=[];const samples=[];let report;
  function passed(name,detail={}){checks.push({name,...detail,passed:true});}
  async function get(target,account,withMetadata=false){return local.request(local.endpoint(target)+'?'+new URLSearchParams({$select:'Id,Name,DisplayName,Path,IsVisible,Hidden,Description,CoverImageBin',...(!withMetadata?{metadata:'no'}:{})}),{account});}
  async function denied(name,target,account){const response=await get(target,account);assert.ok(isDenied(response),`${name}: HTTP ${response.status}`);passed(name,{status:response.status});}
  async function create(name,fields={}){pendingNames.push(name);const timeline=await local.api(CONTAINER,{method:'POST',account:editor,query:{metadata:'no'},body:{__ContentType:'Timeline',Name:name,...fields}});created.push(timeline.Id);return timeline;}
  function fullyRedacted(response){const data=response.value?.d;return response.status===200&&data&&Object.keys(data).length===8&&['Id','Name','DisplayName','Path','IsVisible','Hidden','Description','CoverImageBin'].every(key=>Object.hasOwn(data,key)&&data[key]===null);}
  async function sampleUntil(promise,target){let done=false;let error;const observed=promise.then(value=>{done=true;return value;},failure=>{done=true;error=failure;});while(!done){const response=await get(target,undefined,samples.length%2===0);const data=response.value?.d;const redacted=fullyRedacted(response);const shape=Object.fromEntries(Object.entries(data||{}).map(([key,value])=>[key,value===null?'null':typeof value]));samples.push({status:response.status,visible:data?.IsVisible,hidden:data?.Hidden,fullyRedacted:redacted,shape});if(response.status===200){if(!(data?.IsVisible===true&&data?.Hidden!==true))fs.writeFileSync(path.join(local.ROOT,'timeline-race-redaction.json'),JSON.stringify({ranAt:new Date().toISOString(),response:response.value},null,2));assert.ok(redacted||(data?.IsVisible===true&&data?.Hidden!==true),'Concurrent response was not public or fully redacted: '+JSON.stringify({keys:Object.keys(data||{}),shape,visible:data?.IsVisible,hidden:data?.Hidden,metadataKeys:Object.keys(data?.__metadata||{}),errorCode:response.value?.error?.code}));}else assert.ok(isDenied(response),'Concurrent response was not a native permission denial.');}const result=await observed;if(error)throw error;return result;}
  try {
    assert.equal((await get(CONTAINER)).status,200);assert.equal((await get(CONTAINER,reader)).status,200);passed('Container remains readable to Visitor and OIDC reader');
    for(const [role,account] of [['Visitor',undefined],['OIDC reader',reader]]){const response=await local.request(local.endpoint(CONTAINER),{method:'POST',account,body:{__ContentType:'Timeline',Name:prefix+'-unauthorized',IsVisible:true}});assert.ok(isDenied(response),`${role} unauthorized POST HTTP ${response.status}`);passed(`${role} direct Timeline POST denied`,{status:response.status});}
    const timeline=await sampleUntil(create(prefix),CONTAINER+'/'+prefix);assert.equal(timeline.IsVisible,false);await denied('New default-private Timeline denies Visitor',timeline.Id);await denied('New default-private Timeline denies OIDC reader',timeline.Id,reader);
    assert.equal(await local.api(timeline.Id,{operation:'HasPermission',query:{permissions:'SetPermissions'},account:editor}),false);passed('OIDC editor has no generic SetPermissions');
    const entry=await local.api(timeline.Id,{method:'POST',account:editor,query:{metadata:'no'},body:{__ContentType:'TimelineEntry',Name:'private-entry',Position:1}});await denied('New private entry denies Visitor',entry.Id);await denied('New private entry denies OIDC reader',entry.Id,reader);
    const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=','base64');
    await local.upload(CONTAINER,{name:timeline.Name,contentType:'Timeline',contentId:timeline.Id,field:'CoverImageBin',bytes:image,mime:'image/png',account:editor});
    const binaryUrl=`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${timeline.Id}&propertyname=CoverImageBin`;
    for(const [role,account] of [['Visitor',undefined],['OIDC reader',reader]]){const response=await local.request(binaryUrl,{account});assert.ok(isDenied(response));passed(`New private binary denies ${role}`,{status:response.status});}
    await local.api(timeline.Id,{method:'PATCH',account:editor,body:{IsVisible:true}});assert.equal((await get(timeline.Id)).status,200);assert.equal((await get(entry.Id)).status,200);passed('Successful publish grants actual Timeline and entry Open');
    for(const [role,account] of [['Visitor',undefined],['OIDC reader',reader]]){const response=await local.request(local.endpoint(timeline.Id),{method:'PATCH',account,body:{IsVisible:false}});assert.ok(isDenied(response));assert.equal((await get(timeline.Id)).status,200);passed(`${role} direct visibility PATCH denied without ACL side effect`,{status:response.status});}
    await sampleUntil(local.api(timeline.Id,{method:'PATCH',account:editor,body:{IsVisible:false}}),timeline.Id);await denied('Successful hide revokes actual Timeline Open',timeline.Id);await denied('Hide also revokes private entry Open',entry.Id);assert.ok(isDenied(await local.request(binaryUrl)));passed('Hide revokes binary Open');
    await local.api(timeline.Id,{method:'PATCH',account:editor,body:{IsVisible:true,Hidden:true}});await denied('Hidden overrides IsVisible true at backend',timeline.Id);
    await local.api(timeline.Id,{method:'PATCH',account:editor,body:{Hidden:false}});assert.equal((await get(timeline.Id)).status,200);passed('Unhide with IsVisible true restores public backend Open');
    const collision=await create(prefix+'-collision',{IsVisible:false});
    const failed=await local.request(local.endpoint(timeline.Id),{method:'PATCH',account:editor,body:{IsVisible:false,Name:collision.Name}});assert.ok(failed.status>=400,'Colliding save unexpectedly succeeded.');await denied('Failed hide save remains fail-closed',timeline.Id);passed('Failed save returned an actual backend error',{status:failed.status});
    await local.api(timeline.Id,{method:'PATCH',account:editor,body:{IsVisible:true,Name:timeline.Name}});assert.equal((await get(timeline.Id)).status,200);passed('Editor can recover a failed save by explicit publish');
    for(let iteration=0;iteration<12;iteration++){
      const race=Promise.all([true,false].map(IsVisible=>local.request(local.endpoint(timeline.Id),{method:'PATCH',account:editor,body:{IsVisible}})));
      const outcomes=await sampleUntil(race,timeline.Id);
      for(const outcome of outcomes)assert.ok(outcome.status===200||(outcome.status===400&&outcome.value?.error?.exceptiontype==='NodeIsOutOfDateException'),`Unexpected concurrent save result: HTTP ${outcome.status}`);
      const current=await local.api(timeline.Id,{account:editor,query:{$select:'IsVisible,Hidden',metadata:'no'}});const visitor=await get(timeline.Id);
      // The stock repository rejects a request loaded before a concurrent
      // update. That failed save deliberately leaves read closed; a later
      // successful publish can reopen it. A readable target must always match
      // the persisted flags, and two successful saves must agree with its ACL.
      if(visitor.status===200&&!fullyRedacted(visitor))assert.equal(current.IsVisible===true&&!current.Hidden,true,'Concurrent save disclosed private persisted visibility.');
      else assert.ok(isDenied(visitor)||fullyRedacted(visitor),`Unexpected concurrent read result: HTTP ${visitor.status}`);
      if(outcomes.every(outcome=>outcome.status===200))assert.equal(visitor.status===200,current.IsVisible===true&&!current.Hidden,'Concurrent successful save ACL differs from persisted visibility.');
      passed(`Race ${iteration+1} accepts only success or real stale-version conflict`,{statuses:outcomes.map(outcome=>outcome.status),persistedPublic:current.IsVisible===true&&!current.Hidden,visitorStatus:visitor.status});
      await local.api(timeline.Id,{method:'PATCH',account:editor,body:{IsVisible:false}});await denied(`Race ${iteration+1} final private state is denied`,timeline.Id);
    }
    passed('Concurrent publish/hide samples never disclose private field state',{samples:samples.length});
    report={version:1,ranAt:new Date().toISOString(),repository:local.REPOSITORY,authentication:'Real local IdentityServer password + authorization code PKCE, repository GetCurrentUser verified. No API-key role substitution.',checks,samples,passed:false};return report;
  }catch(error){fs.writeFileSync(path.join(local.ROOT,'timeline-privacy-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),checks,samples,passed:false,error:error.message},null,2));console.error(JSON.stringify({completedChecks:checks.map(check=>check.name),failure:error.message}));throw error;
  }finally{
    try{for(const name of pendingNames){try{const content=await local.api(CONTAINER+'/'+name,{account:admin,query:{$select:'Id',metadata:'no'}});if(!created.includes(content.Id))created.push(content.Id);}catch(error){if(error.status!==404)throw error;}}
      const sourceIds=new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT,'restore-journal.json'),'utf8')).idMap));
      for(const id of created.reverse()){const content=await local.api(id,{account:admin,query:{$select:'Id,Name,Path',metadata:'no'}});assert.ok(!sourceIds.has(id)&&content.Id===id&&pendingNames.includes(content.Name)&&content.Path===CONTAINER+'/'+content.Name,'UUID cleanup ownership failed.');await local.api(id,{method:'DELETE',account:admin,query:{permanent:'true'}});assert.equal((await local.request(local.endpoint(id),{account:admin})).status,404);}
      if(report){Object.assign(report,{passed:true,cleaned:created.length});fs.writeFileSync(path.join(local.ROOT,'timeline-privacy-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,checks:checks.length,raceSamples:samples.length,redactedSamples:samples.filter(sample=>sample.fullyRedacted).length,cleaned:created.length}));}
    }catch(error){fs.writeFileSync(path.join(local.ROOT,'timeline-privacy-smoke.json'),JSON.stringify({ranAt:new Date().toISOString(),checks,samples,passed:false,error:'UUID cleanup ownership or deletion failed.'},null,2));throw error;}
  }
}
module.exports={smoke};if(require.main===module)smoke().catch(error=>{console.error(error.message);process.exitCode=1;});
