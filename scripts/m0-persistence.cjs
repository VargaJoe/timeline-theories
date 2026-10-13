'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const local=require('./m0-local-api.cjs');const {restore}=require('./m0-restore.cjs');const {sha256,verifySnapshot}=require('./m0-snapshot.cjs');
async function persistence(directory){
  // Reject a missing or invalid source before changing any service state.
  await verifySnapshot(directory);
  const journalPath=path.join(local.ROOT,'restore-journal.json');
  const before=sha256(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(journalPath,'utf8')).idMap)));
  const runtime=path.resolve(__dirname,'../deployment/scripts/m0-runtime.ps1');
  for(const action of ['stop','start'])execFileSync('pwsh',['-NoProfile','-File',runtime,'-Action',action],{stdio:'inherit'});
  const deadline=Date.now()+120000;let ready=false;
  while(Date.now()<deadline){try{const result=await local.api('/Root',{account:local.readAccounts().admin,query:{$select:'Id',metadata:'no'}});if(Number.isInteger(result.Id)){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!ready)throw new Error('Repository did not become ready after the owned stop/start.');
  const verification=await restore(directory,{verifyOnly:true});
  const after=sha256(Buffer.from(JSON.stringify(JSON.parse(fs.readFileSync(journalPath,'utf8')).idMap)));
  if(before!==after)throw new Error('Restore ID map changed across restart.');
  const report={testedAt:new Date().toISOString(),method:'Stop/start only timeline-m0 services; retain all owned and unrelated volumes.',idMapHash:before,records:verification.actualCount,fieldMismatches:verification.fieldMismatches.length,referenceMismatches:verification.referenceMismatches.length,binaryMismatches:verification.binaryMismatches.length,orderMismatches:verification.orderMismatches.length,passed:true};
  fs.writeFileSync(path.join(local.ROOT,'persistence-verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
module.exports={persistence};if(require.main===module)persistence(path.resolve(process.argv[2]||'')).catch(error=>{console.error(error.message);process.exitCode=1;});
