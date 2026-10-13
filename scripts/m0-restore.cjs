'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {verifySnapshot, ROOT_PATH, sha256, isExcludedField} = require('./m0-snapshot.cjs');
const local = require('./m0-local-api.cjs');
const SYSTEM_FIELDS = new Set(['Id','ParentId','Path','Type','TypeIs','Depth','Version','VersionId','CreationDate','ModificationDate','VersionCreationDate','VersionModificationDate','Locked','SavingState','IsFolder','IsSystemContent','IsFollowed','RateAvg','RateCount','RateStr','Workspace','EffectiveAllowedChildTypes','InTree','InFolder','Approvable','ApprovingMode','InheritableApprovingMode','InheritableVersioningMode','PreviewEnabled','VersioningMode','IsRateable','Rate','Publishable']);
const WRITABLE_TYPES = new Set(['ShortText','LongText','Integer','Number','Boolean','DateTime','Choice','AllowedChildTypes','Reference']);
function fieldCategory(definition) {
  if(isExcludedField(definition.name))return 'excludedIdentityOrVersion';
  if(SYSTEM_FIELDS.has(definition.name))return 'serverGenerated';
  if(definition.type==='Binary')return 'binary';
  if(definition.readOnly)return 'readOnly';
  return WRITABLE_TYPES.has(definition.type)?'scalarOrReference':'unsupported';
}
function schemaCoverage(schemas) {
  return Object.entries(schemas).map(([type,schema])=>{
    const categories={excludedIdentityOrVersion:[],serverGenerated:[],readOnly:[],scalarOrReference:[],binary:[],unsupported:[]};
    for(const definition of schema.fields)categories[fieldCategory(definition)].push({name:definition.name,type:definition.type});
    return {type,totalFields:schema.fields.length,...categories};
  });
}
function assertSchemaCoverage(schemas) {
  const coverage=schemaCoverage(schemas);const unsupported=coverage.flatMap(schema=>schema.unsupported.map(field=>`${schema.type}.${field.name} (${field.type})`));
  if(unsupported.length)throw new Error(`Unsupported source fields; refusing incomplete restore/verification: ${unsupported.join(', ')}`);
  return coverage;
}
function writeJson(file,value) {const temp=file+'.pending';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
function fieldPlan(record,schema,{references=false}={}) {
  const fields={};
  for(const definition of schema.fields) {
    const name=definition.name;
    const category=fieldCategory(definition);
    if(category==='unsupported')throw new Error(`Unsupported source field ${name} (${definition.type}); refusing omission.`);
    if(category!=='scalarOrReference' || !(name in record.fields)) continue;
    if((definition.type==='Reference')!==references) continue;
    const value=record.fields[name];
    if(value===null || value===undefined) { if(definition.type!=='Integer' && definition.type!=='Boolean' && definition.type!=='Number') fields[name]=value; continue; }
    fields[name]=value;
  }
  return fields;
}
function mapReferences(fields,map) {
  const result={};
  for(const [name,values] of Object.entries(fields)) {
    if(values===null) {result[name]=null;continue;}
    if(!Array.isArray(values)) throw new Error(`Reference ${name} is not an ID array.`);
    result[name]=values.map(id=>{if(!map[id]) throw new Error(`Orphan source reference ${name} -> ${id}.`);return map[id];});
  }
  return result;
}
function canonical(value) {if(Array.isArray(value)) return value.length?JSON.stringify(value):'null'; return JSON.stringify(value??null);}
function fieldMatches(schema,name,expected,received) {
  const definition=schema.fields.find(x=>x.name===name);
  if(definition?.type==='AllowedChildTypes' && Array.isArray(received))received=received.map(x=>typeof x==='string'?x:x.Name);
  if(expected===null && received==='' && ['ShortText','LongText'].includes(definition?.type))return true;
  return canonical(expected)===canonical(received);
}
function sourceIntegrity(records) {
  const ids=new Set(records.map(r=>r.id)); const paths=new Set(); const orphanReferences=[]; const duplicatePaths=[]; const repeatedMedia=[]; const duplicatePositions=[];
  const group=new Map();
  for(const record of records) {
    if(paths.has(record.path)) duplicatePaths.push(record.path);paths.add(record.path);
    if(record.type!=='TimelineEntry') continue;
    for(const id of record.fields.MediaItem || []) if(!ids.has(id)) orphanReferences.push({entryId:record.id,mediaId:id});
    const parent=record.path.slice(0,record.path.lastIndexOf('/'));if(!group.has(parent))group.set(parent,[]);group.get(parent).push(record);
  }
  for(const [timeline,entries] of group) {
    const media=new Map(),positions=new Map();
    for(const record of entries){for(const id of record.fields.MediaItem || [])media.set(id,[...(media.get(id)||[]),record.id]); const p=record.fields.Position;positions.set(p,[...(positions.get(p)||[]),record.id]);}
    for(const [id,entryIds] of media)if(entryIds.length>1)repeatedMedia.push({timeline,mediaId:id,entryIds});
    for(const [position,entryIds] of positions)if(entryIds.length>1)duplicatePositions.push({timeline,position,entryIds});
  }
  return {orphanReferences,duplicatePaths,repeatedMedia,duplicatePositions};
}
async function loadAll(account,expandFields=[]) {
  const records=[];let skip=0,total;
  do {
    const url=local.REPOSITORY+'/OData.svc/Root/Content?'+new URLSearchParams({query:`+InTree:${ROOT_PATH} .SORT:Id .AUTOFILTERS:OFF .LIFESPAN:OFF`,$top:'200',$skip:String(skip),$inlinecount:'allpages',metadata:'no',...(expandFields.length?{$expand:expandFields.join(',')}:{})});
    const response=await local.request(url,{account});if(response.status!==200)throw new Error(`Local verification query HTTP ${response.status}`);
    const page=response.value.d;total=page.__count;records.push(...page.results);if(!page.results.length&&records.length<total)throw new Error('Local pagination ended early.');skip+=page.results.length;
  } while(skip<total);
  return records;
}
async function verifyRestore(snapshot,journal) {
  const {records,schemas,manifest,directory}=snapshot;
  const coverage=assertSchemaCoverage(schemas);
  const account=local.readAccounts().admin;
  const expandFields=['AllowedChildTypes',...new Set(records.flatMap(record=>Object.keys(fieldPlan(record,schemas[record.type],{references:true}))))];
  const actual=await loadAll(account,expandFields);
  const byId=new Map(actual.map(x=>[x.Id,x]));const fieldMismatches=[],referenceMismatches=[],binaryMismatches=[],orderMismatches=[];
  for(const record of records) {
    const target=byId.get(journal.idMap[record.id]);if(!target){fieldMismatches.push({sourceId:record.id,error:'missing local ID'});continue;}
    if(target.Path!==record.path || target.Type!==record.type) fieldMismatches.push({sourceId:record.id,field:'Path/Type'});
    const primitive=fieldPlan(record,schemas[record.type]);
    for(const [field,value] of Object.entries(primitive)) {
      // SenseNet returns null for empty Choice; both describe no selected value.
      const emptyChoice=Array.isArray(value)&&value.length===0&&target[field]===null;
      if(!emptyChoice && !fieldMatches(schemas[record.type],field,value,target[field])) fieldMismatches.push({sourceId:record.id,field,expected:value,actual:target[field]});
    }
    const references=mapReferences(fieldPlan(record,schemas[record.type],{references:true}),journal.idMap);
    for(const [field,values] of Object.entries(references)) {
      const raw=target[field];const localIds=raw?.results?raw.results.map(x=>x.Id):Array.isArray(raw)?raw.map(x=>x.Id):raw?.Id?[raw.Id]:null;
      if(canonical(values)!==canonical(localIds) && !(values?.length===0&&localIds===null))referenceMismatches.push({sourceId:record.id,field,expected:values,actual:localIds});
    }
  }
  for(const binary of manifest.binaries) {
    const id=journal.idMap[binary.contentId];const response=await local.request(`${local.REPOSITORY}/binaryhandler.ashx?nodeid=${id}&propertyname=${encodeURIComponent(binary.field)}`,{account});
    if(response.status!==200 || sha256(response.bytes)!==binary.sha256)binaryMismatches.push({sourceId:binary.contentId,field:binary.field,status:response.status,expected:binary.sha256,actual:sha256(response.bytes)});
  }
  const expectedSequences=new Map();for(const record of records.filter(r=>r.type==='TimelineEntry')){const timeline=record.path.slice(0,record.path.lastIndexOf('/'));if(!expectedSequences.has(timeline))expectedSequences.set(timeline,[]);expectedSequences.get(timeline).push(record);}
  for(const [timeline,entries] of expectedSequences){for(const field of ['Position','ReleaseOrderPosition']){const expected=entries.toSorted((a,b)=>(a.fields[field]-b.fields[field])||(a.id-b.id)).map(x=>journal.idMap[x.id]);const received=actual.filter(x=>x.Type==='TimelineEntry' && x.Path.slice(0,x.Path.lastIndexOf('/'))===timeline).toSorted((a,b)=>(a[field]-b[field])||(Object.keys(journal.idMap).find(k=>journal.idMap[k]===a.Id)-Object.keys(journal.idMap).find(k=>journal.idMap[k]===b.Id))).map(x=>x.Id);if(canonical(expected)!==canonical(received))orderMismatches.push({timeline,field});}}
  const report={checkedAt:new Date().toISOString(),snapshot:directory,schemaCoverage:coverage,expectedCount:records.length,actualCount:actual.length,countMatches:records.length===actual.length,idMapCount:Object.keys(journal.idMap).length,fieldMismatches,referenceMismatches,binaryMismatches,orderMismatches,sourceIntegrity:sourceIntegrity(records),serverGeneratedFieldsPreservedInSnapshot:[...SYSTEM_FIELDS],productionIdentityPolicy:'Identities, secrets and production ACLs are not imported. Local ACLs and account IDs are independent.'};
  report.passed=report.countMatches&&!fieldMismatches.length&&!referenceMismatches.length&&!binaryMismatches.length&&!orderMismatches.length;
  writeJson(path.join(local.ROOT,'restore-verification.json'),report);
  return report;
}
async function restore(directory,{verifyOnly=false}={}) {
  const snapshot=await verifySnapshot(directory);const {records,schemas,manifest}=snapshot;
  assertSchemaCoverage(schemas); // Fail before journal writes or any local mutation.
  const sourceHash=sha256(fs.readFileSync(path.join(directory,manifest.contentFile.path || manifest.contentFile)));
  const sourceManifestHash=sha256(fs.readFileSync(path.join(directory,'manifest.json')));
  const journalPath=path.join(local.ROOT,'restore-journal.json');
  let journal=fs.existsSync(journalPath)?JSON.parse(fs.readFileSync(journalPath,'utf8')):{version:1,sourceHash,sourceManifestHash,sourceDirectory:path.resolve(directory),idMap:{},phase:'create',completed:false};
  if(journal.sourceHash!==sourceHash)throw new Error('An owned restore already uses another snapshot. Refusing replacement.');
  if(journal.sourceManifestHash && journal.sourceManifestHash!==sourceManifestHash)throw new Error('Snapshot manifest changed; refusing restore replacement.');
  if(!journal.sourceManifestHash){if(journal.sourceDirectory!==path.resolve(directory))throw new Error('A legacy restore journal can only bind its original snapshot directory.');journal.sourceManifestHash=sourceManifestHash;writeJson(journalPath,journal);}
  if(verifyOnly || journal.completed || journal.phase==='verify'){const result=await verifyRestore(snapshot,journal);console.log(JSON.stringify({phase:'verify',passed:result.passed,expectedCount:result.expectedCount,actualCount:result.actualCount,fieldMismatches:result.fieldMismatches.length,referenceMismatches:result.referenceMismatches.length,binaryMismatches:result.binaryMismatches.length,orderMismatches:result.orderMismatches.length}));if(!result.passed)throw new Error('Restore integrity failed; inspect ignored restore-verification.json.');if(journal.phase==='verify' && !journal.completed){journal.completed=true;journal.completedAt=new Date().toISOString();writeJson(journalPath,journal);}return result;}
  const integrity=sourceIntegrity(records);if(integrity.duplicatePaths.length || integrity.orphanReferences.length)throw new Error('Source has duplicate paths or orphan media references; restore requires explicit resolution.');
  const account=local.readAccounts().admin;
  async function closeProject(id){const accounts=local.readAccounts();await require('./m0-acl.cjs').permissions(id,[{identity:'/Root/IMS/BuiltIn/Portal/Visitor',See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'},{identity:accounts.reader.path,See:'deny',Open:'deny',OpenMinor:'deny',SeePermissions:'deny'}]);}
  const sourceRoot=records.find(record=>record.path===ROOT_PATH);
  if(journal.idMap[sourceRoot.id])await closeProject(journal.idMap[sourceRoot.id]);
  writeJson(journalPath,journal);
  const ordered=records.toSorted((a,b)=>a.path.split('/').length-b.path.split('/').length||a.id-b.id);
  let created=0;
  for(const record of ordered) {
    if(journal.idMap[record.id])continue;
    const parent=record.path.slice(0,record.path.lastIndexOf('/'));
    const fields=fieldPlan(record,schemas[record.type]);
    let existing;try{existing=await local.api(record.path,{account,query:{metadata:'no',$expand:'AllowedChildTypes'}});}catch(error){if(error.status!==404)throw error;}
    if(existing){
      // A lost response after a successful POST is recoverable only inside the
      // same journal-owned namespace, with the exact source field values.
      const ownedParent=records.find(x=>x.path===parent);
      const matches=existing.Type===record.type&&Object.entries(fields).every(([name,value])=>fieldMatches(schemas[record.type],name,value,existing[name]));
      if(!ownedParent || !journal.idMap[ownedParent.id] || !matches)throw new Error(`Unowned or changed existing local path: ${record.path}. Refusing overwrite.`);
    }
    const content=existing || await local.api(parent,{method:'POST',account,query:{metadata:'no'},body:{__ContentType:record.type,...fields}});
    journal.idMap[record.id]=content.Id;writeJson(journalPath,journal);created++;
    if(record.path===ROOT_PATH)await closeProject(content.Id);
    if(created%250===0)console.log(JSON.stringify({phase:'create',mapped:Object.keys(journal.idMap).length,total:records.length}));
  }
  journal.phase='references';writeJson(journalPath,journal);
  for(const record of records){const refs=mapReferences(fieldPlan(record,schemas[record.type],{references:true}),journal.idMap);if(Object.values(refs).some(x=>Array.isArray(x)&&x.length))await local.api(journal.idMap[record.id],{method:'PATCH',account,query:{metadata:'no'},body:refs});}
  journal.phase='binaries';writeJson(journalPath,journal);let uploaded=0;
  for(const binary of manifest.binaries){if(binary.bytes===0)continue;const record=records.find(x=>x.id===binary.contentId);await local.upload(record.path.slice(0,record.path.lastIndexOf('/')),{name:record.name,bytes:fs.readFileSync(path.join(directory,binary.path)),contentType:record.type,field:binary.field,contentId:journal.idMap[record.id],mime:binary.contentType || 'application/octet-stream',account});uploaded++;if(uploaded%100===0)console.log(JSON.stringify({phase:'binaries',uploaded}));}
  journal.phase='verify';writeJson(journalPath,journal);const result=await verifyRestore(snapshot,journal);
  if(!result.passed)throw new Error('Restore integrity failed; inspect ignored restore-verification.json.');
  journal.completed=true;journal.completedAt=new Date().toISOString();writeJson(journalPath,journal);
  console.log(JSON.stringify({phase:'complete',records:records.length,binaries:manifest.binaries.length,uploaded,passed:true}));return result;
}
module.exports={fieldPlan,mapReferences,sourceIntegrity,schemaCoverage,assertSchemaCoverage,restore,verifyRestore,SYSTEM_FIELDS};
if(require.main===module) restore(path.resolve(process.argv[2]||''),{verifyOnly:process.argv.includes('--verify')}).catch(error=>{console.error(error.message);process.exitCode=1;});
