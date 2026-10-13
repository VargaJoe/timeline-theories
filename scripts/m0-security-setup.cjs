'use strict';
const fs=require('node:fs');const path=require('node:path');
const local=require('./m0-local-api.cjs');const {secureTimelineContainer,permissions}=require('./m0-acl.cjs');
const CONTAINER='/Root/Content/timelines/Timelines';
async function configure(){
  const accounts=local.readAccounts();
  try{await local.api(CONTAINER,{account:accounts.admin,query:{$select:'Id',metadata:'no'}});}catch(error){if(error.status!==404)throw error;console.log('No local Timeline container yet; restore keeps project closed until ACL setup.');return;}
  const timelines=[];let skip=0,total;
  do{const query=new URLSearchParams({query:`+InTree:${CONTAINER} +Type:Timeline .SORT:Id .AUTOFILTERS:OFF .LIFESPAN:OFF`,$select:'Id,IsVisible,Hidden',$top:'200',$skip:String(skip),$inlinecount:'allpages',metadata:'no'});const response=await local.request(local.REPOSITORY+'/OData.svc/Root/Content?'+query,{account:accounts.admin});if(response.status!==200)throw new Error(`Timeline security query HTTP ${response.status}`);const page=response.value.d;total=page.__count;timelines.push(...page.results);if(!page.results.length&&timelines.length<total)throw new Error('Timeline security setup pagination ended early.');skip+=page.results.length;}while(skip<total);
  const readers=['/Root/IMS/BuiltIn/Portal/Visitor',accounts.reader.path];
  const privateTimelines=timelines.filter(timeline=>timeline.IsVisible!==true||timeline.Hidden===true);
  for(const timeline of privateTimelines)await permissions(timeline.Id,readers.map(identity=>({identity,See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'})));
  const publicTimelines=timelines.filter(timeline=>timeline.IsVisible===true&&timeline.Hidden!==true);
  await secureTimelineContainer(CONTAINER,{publicTimelineIds:publicTimelines.map(timeline=>timeline.Id)});
  const report={version:2,configuredAt:new Date().toISOString(),container:CONTAINER,privateTimelines:privateTimelines.length,publicTimelines:publicTimelines.length,policy:'Current local visibility fields determine ACL. Reader grants on container are localOnly; new Timeline inherits no public read. Privileged fixed-reader visibility handler is required for future saves. No source fields, IDs, order or binary are changed.'};
  fs.writeFileSync(path.join(local.ROOT,'timeline-security-setup.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));return report;
}
module.exports={configure};if(require.main===module)configure().catch(error=>{console.error(error.message);process.exitCode=1;});
